#include "grohe_sense_guard.h"
#include "esphome/core/hal.h"

namespace esphome {
namespace grohe_sense_guard {

// ─────────────────────────────────────────────────────────────────────────────
// Setup / Loop
// ─────────────────────────────────────────────────────────────────────────────

void GroheSenseGuard::setup() {
  ESP_LOGI(TAG, "Grohe Sense Guard component ready");
}

void GroheSenseGuard::loop() {
  const uint32_t now = millis();

  // Flush incomplete frame if no byte received for 50 ms
  if (in_frame_ && (now - last_byte_ms_ > 50)) {
    ESP_LOGW(TAG, "Frame timeout, flushing %u bytes", (unsigned)rx_buf_.size());
    rx_buf_.clear();
    in_frame_ = false;
  }

  while (available()) {
    uint8_t byte;
    read_byte(&byte);
    process_byte_(byte);
    last_byte_ms_ = now;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Byte-level receive state machine
// ─────────────────────────────────────────────────────────────────────────────

void GroheSenseGuard::process_byte_(uint8_t byte) {
  // Ignore wake bytes outside a frame
  if (!in_frame_ && byte == GROHE_WAKE_BYTE) return;

  if (!in_frame_) {
    if (byte == GROHE_START_BYTE) {
      rx_buf_.clear();
      rx_buf_.push_back(byte);
      in_frame_ = true;
    }
    return;
  }

  rx_buf_.push_back(byte);

  // Minimum frame: 68 [6addr] 68 ctrl len 00 00 len 0C 61 type flags 00 00 seq CS 16
  // = 1+6+1+1+1+2+1+1+1+1+1+1+1+2+1+1 = 22 bytes minimum
  if (byte == GROHE_STOP_BYTE && rx_buf_.size() >= 22) {
    process_frame_();
    rx_buf_.clear();
    in_frame_ = false;
  }

  // Safety: discard if buffer too large (max frame ~200 bytes)
  if (rx_buf_.size() > 200) {
    ESP_LOGW(TAG, "Frame buffer overflow, discarding");
    rx_buf_.clear();
    in_frame_ = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Frame parser dispatcher
// ─────────────────────────────────────────────────────────────────────────────

void GroheSenseGuard::process_frame_() {
  GroheFrame frame;
  if (!parse_frame(rx_buf_, frame)) {
    ESP_LOGD(TAG, "Failed to parse frame (%u bytes)", (unsigned)rx_buf_.size());
    return;
  }

  // Remember device address for sending commands back
  memcpy(dev_addr_, frame.addr, 6);

  ESP_LOGD(TAG, "Frame: type=0x%02X flags=0x%02X seq=%u payload=%u bytes",
           frame.msg_type, frame.flags, frame.seq, (unsigned)frame.payload.size());

  switch (frame.msg_type) {
    case MSG_INFO:      handle_info_(frame);    break;
    case MSG_STATUS:    handle_status_(frame);  break;
    case MSG_CONFIG:
    case MSG_CONFIG_RESP: handle_config_(frame); break;
    case MSG_HEARTBEAT:
      ESP_LOGD(TAG, "Heartbeat seq=%u", frame.seq);
      break;
    case MSG_WATER_DATA:
      ESP_LOGD(TAG, "Water data seq=%u", frame.seq);
      break;
    default:
      ESP_LOGD(TAG, "Unknown type 0x%02X", frame.msg_type);
      break;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Info packet (firmware version, device serial)
// ─────────────────────────────────────────────────────────────────────────────

void GroheSenseGuard::handle_info_(const GroheFrame &f) {
  // ASCII identifier starts at payload[13] (after fixed header fields)
  // "^1Z16010C186E000200040004" = firmware/serial string
  if (firmware_version_ && f.payload.size() >= 14) {
    std::string ver;
    for (size_t i = 13; i < f.payload.size(); i++) {
      uint8_t b = f.payload[i];
      if (b == 0x00) break;
      if (b >= 0x20 && b < 0x7F) ver += static_cast<char>(b);
    }
    if (!ver.empty()) {
      ESP_LOGI(TAG, "Firmware/ID: %s", ver.c_str());
      firmware_version_->publish_state(ver);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Status packet (valve, snooze, pressure test)
// ─────────────────────────────────────────────────────────────────────────────

void GroheSenseGuard::handle_status_(const GroheFrame &f) {
  const auto &p = f.payload;

  if (p.size() <= STATUS_SNOOZE) {
    ESP_LOGW(TAG, "Status packet too short: %u", (unsigned)p.size());
    return;
  }

  bool ptest  = (p[STATUS_PRESSURE_TEST] == 0x08);
  bool vopen  = (p[STATUS_VALVE_STATE]   == 0x01);
  bool snooze = (p[STATUS_SNOOZE]        == 0x01);

  ESP_LOGI(TAG, "Status: valve=%s snooze=%s pressure_test=%s",
           vopen ? "OPEN" : "CLOSED",
           snooze ? "ON" : "OFF",
           ptest ? "RUNNING" : "idle");

  if (valve_open_)    valve_open_->publish_state(vopen);
  if (snooze_active_) snooze_active_->publish_state(snooze);
  if (pressure_test_) pressure_test_->publish_state(ptest);
}

// ─────────────────────────────────────────────────────────────────────────────
// Config packet (sprinkler times and days)
// ─────────────────────────────────────────────────────────────────────────────

void GroheSenseGuard::handle_config_(const GroheFrame &f) {
  const auto &p = f.payload;

  if (p.size() <= CFG_SPRINKLER_SUN) {
    ESP_LOGW(TAG, "Config packet too short: %u", (unsigned)p.size());
    return;
  }

  // Cache config for later partial writes (e.g. only change sprinkler days)
  last_config_payload_ = p;

  uint16_t start_min = (static_cast<uint16_t>(p[CFG_SPRINKLER_START + 1]) << 8)
                      | p[CFG_SPRINKLER_START];
  uint16_t stop_min  = (static_cast<uint16_t>(p[CFG_SPRINKLER_STOP + 1]) << 8)
                      | p[CFG_SPRINKLER_STOP];

  ESP_LOGI(TAG, "Config: sprinkler %02u:%02u – %02u:%02u  days=",
           start_min / 60, start_min % 60,
           stop_min  / 60, stop_min  % 60);

  static const char *day_names[] = {"Mon","Tue","Wed","Thu","Fri","Sat","Sun"};
  for (int d = 0; d < 7; d++) {
    bool active = (p[CFG_SPRINKLER_MON + d] == 0x01);
    ESP_LOGI(TAG, "  %s: %s", day_names[d], active ? "ON" : "off");
    if (sprinkler_days_[d]) sprinkler_days_[d]->publish_state(active);
  }

  if (sprinkler_start_) sprinkler_start_->publish_state(start_min);
  if (sprinkler_stop_)  sprinkler_stop_->publish_state(stop_min);
}

// ─────────────────────────────────────────────────────────────────────────────
// Command: Valve open
// ─────────────────────────────────────────────────────────────────────────────

void GroheSenseGuard::valve_open() {
  ESP_LOGI(TAG, "CMD: valve open");
  // Status payload with valve=0x01
  // Based on observed status packet structure: 00 00 [seq] 00 00 00 07 01 ...
  std::vector<uint8_t> data = {0x00, 0x00, next_seq_(),
                                0x00, 0x00, 0x00, 0x07,
                                0x01, // valve open
                                0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02};
  send_frame_(build_frame(dev_addr_, MSG_STATUS, FLAG_WRITE, data[2], data));
}

// ─────────────────────────────────────────────────────────────────────────────
// Command: Valve close
// ─────────────────────────────────────────────────────────────────────────────

void GroheSenseGuard::valve_close() {
  ESP_LOGI(TAG, "CMD: valve close");
  std::vector<uint8_t> data = {0x00, 0x00, next_seq_(),
                                0x00, 0x00, 0x00, 0x07,
                                0x00, // valve closed
                                0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02};
  send_frame_(build_frame(dev_addr_, MSG_STATUS, FLAG_WRITE, data[2], data));
}

// ─────────────────────────────────────────────────────────────────────────────
// Command: Snooze start
// ─────────────────────────────────────────────────────────────────────────────

void GroheSenseGuard::snooze_start(uint16_t duration_minutes) {
  ESP_LOGI(TAG, "CMD: snooze start %u min", duration_minutes);
  std::vector<uint8_t> data = {0x00, 0x00, next_seq_(),
                                0x00, 0x00, 0x00, 0x07,
                                0x00,
                                0x00, 0x00, 0x00, 0x00,
                                0x01, // snooze active
                                static_cast<uint8_t>(duration_minutes & 0xFF),
                                static_cast<uint8_t>(duration_minutes >> 8),
                                0x02};
  send_frame_(build_frame(dev_addr_, MSG_STATUS, FLAG_WRITE, data[2], data));
}

// ─────────────────────────────────────────────────────────────────────────────
// Command: Snooze stop
// ─────────────────────────────────────────────────────────────────────────────

void GroheSenseGuard::snooze_stop() {
  ESP_LOGI(TAG, "CMD: snooze stop");
  std::vector<uint8_t> data = {0x00, 0x00, next_seq_(),
                                0x00, 0x00, 0x00, 0x07,
                                0x00,
                                0x00, 0x00, 0x00, 0x00,
                                0x00, // snooze off
                                0x00, 0x00, 0x02};
  send_frame_(build_frame(dev_addr_, MSG_STATUS, FLAG_WRITE, data[2], data));
}

// ─────────────────────────────────────────────────────────────────────────────
// Command: Sprinkler configure
// ─────────────────────────────────────────────────────────────────────────────

void GroheSenseGuard::set_sprinkler(uint16_t start_min, uint16_t stop_min, bool days[7]) {
  if (last_config_payload_.empty()) {
    ESP_LOGW(TAG, "No config cached yet – wait for first config packet");
    return;
  }

  // Modify a copy of the last known config
  std::vector<uint8_t> payload = last_config_payload_;
  payload[PAY_SEQ] = next_seq_();
  payload[CFG_SPRINKLER_START]     = start_min & 0xFF;
  payload[CFG_SPRINKLER_START + 1] = start_min >> 8;
  payload[CFG_SPRINKLER_STOP]      = stop_min & 0xFF;
  payload[CFG_SPRINKLER_STOP + 1]  = stop_min >> 8;
  for (int d = 0; d < 7; d++)
    payload[CFG_SPRINKLER_MON + d] = days[d] ? 0x01 : 0x00;

  ESP_LOGI(TAG, "CMD: sprinkler %02u:%02u – %02u:%02u",
           start_min / 60, start_min % 60,
           stop_min  / 60, stop_min  % 60);

  send_frame_(build_frame(dev_addr_, MSG_CONFIG, FLAG_WRITE, payload[PAY_SEQ], payload));
}

// ─────────────────────────────────────────────────────────────────────────────
// Command: Sprinkler off (all days disabled)
// ─────────────────────────────────────────────────────────────────────────────

void GroheSenseGuard::sprinkler_off() {
  bool days[7] = {false, false, false, false, false, false, false};
  set_sprinkler(0, 0, days);
}

// ─────────────────────────────────────────────────────────────────────────────
// Send a raw frame via UART
// ─────────────────────────────────────────────────────────────────────────────

void GroheSenseGuard::send_frame_(const std::vector<uint8_t> &frame) {
  ESP_LOGD(TAG, "TX %u bytes", (unsigned)frame.size());
  for (uint8_t b : frame) write_byte(b);
}

}  // namespace grohe_sense_guard
}  // namespace esphome

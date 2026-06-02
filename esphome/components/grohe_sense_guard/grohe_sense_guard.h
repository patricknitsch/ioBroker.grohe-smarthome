#pragma once

#include "esphome/core/component.h"
#include "esphome/core/log.h"
#include "esphome/components/uart/uart.h"
#include "esphome/components/sensor/sensor.h"
#include "esphome/components/binary_sensor/binary_sensor.h"
#include "esphome/components/text_sensor/text_sensor.h"
#include "grohe_protocol.h"
#include <vector>

namespace esphome {
namespace grohe_sense_guard {

static const char *const TAG = "grohe";

class GroheSenseGuard : public Component, public uart::UARTDevice {
 public:
  // ── Sensor setters (called from sensor.py / binary_sensor.py) ────────────
  void set_valve_open(binary_sensor::BinarySensor *s)   { valve_open_ = s; }
  void set_snooze_active(binary_sensor::BinarySensor *s) { snooze_active_ = s; }
  void set_pressure_test(binary_sensor::BinarySensor *s) { pressure_test_ = s; }

  void set_sprinkler_monday(binary_sensor::BinarySensor *s)    { sprinkler_days_[0] = s; }
  void set_sprinkler_tuesday(binary_sensor::BinarySensor *s)   { sprinkler_days_[1] = s; }
  void set_sprinkler_wednesday(binary_sensor::BinarySensor *s) { sprinkler_days_[2] = s; }
  void set_sprinkler_thursday(binary_sensor::BinarySensor *s)  { sprinkler_days_[3] = s; }
  void set_sprinkler_friday(binary_sensor::BinarySensor *s)    { sprinkler_days_[4] = s; }
  void set_sprinkler_saturday(binary_sensor::BinarySensor *s)  { sprinkler_days_[5] = s; }
  void set_sprinkler_sunday(binary_sensor::BinarySensor *s)    { sprinkler_days_[6] = s; }

  void set_sprinkler_start(sensor::Sensor *s) { sprinkler_start_ = s; }
  void set_sprinkler_stop(sensor::Sensor *s)  { sprinkler_stop_ = s; }
  void set_firmware_version(text_sensor::TextSensor *s) { firmware_version_ = s; }

  // ── ESPHome lifecycle ────────────────────────────────────────────────────
  void setup() override;
  void loop() override;
  float get_setup_priority() const override { return setup_priority::DATA; }

  // ── Command API ──────────────────────────────────────────────────────────
  void valve_open();
  void valve_close();
  void snooze_start(uint16_t duration_minutes);
  void snooze_stop();
  void set_sprinkler(uint16_t start_min, uint16_t stop_min, bool days[7]);
  void sprinkler_off();

 protected:
  // ── Receive buffer ───────────────────────────────────────────────────────
  std::vector<uint8_t> rx_buf_;
  bool in_frame_{false};
  uint32_t last_byte_ms_{0};

  // ── Last known device address ────────────────────────────────────────────
  uint8_t dev_addr_[6]{0x99, 0x99, 0x99, 0x99, 0x99, 0x99};
  uint8_t tx_seq_{0x20}; // outgoing sequence counter

  // ── Last known config payload (used for partial writes) ─────────────────
  std::vector<uint8_t> last_config_payload_;

  // ── Sensors ─────────────────────────────────────────────────────────────
  binary_sensor::BinarySensor *valve_open_{nullptr};
  binary_sensor::BinarySensor *snooze_active_{nullptr};
  binary_sensor::BinarySensor *pressure_test_{nullptr};
  binary_sensor::BinarySensor *sprinkler_days_[7]{};
  sensor::Sensor *sprinkler_start_{nullptr};
  sensor::Sensor *sprinkler_stop_{nullptr};
  text_sensor::TextSensor *firmware_version_{nullptr};

  // ── Internal helpers ─────────────────────────────────────────────────────
  void process_byte_(uint8_t byte);
  void process_frame_();
  void handle_info_(const GroheFrame &f);
  void handle_status_(const GroheFrame &f);
  void handle_config_(const GroheFrame &f);
  void send_frame_(const std::vector<uint8_t> &frame);
  uint8_t next_seq_() { return tx_seq_++; }
};

}  // namespace grohe_sense_guard
}  // namespace esphome

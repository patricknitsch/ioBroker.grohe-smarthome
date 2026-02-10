# ioBroker Grohe Smarthome Adapter

This adapter connects ioBroker to the **Grohe Smarthome / Ondus** cloud and exposes Grohe devices as states (and some controls) inside ioBroker.

It supports:

- **Grohe Sense** (type `101`)
- **Grohe Sense Guard** (type `103`)
- **Grohe Blue Home** (type `104`)
- **Grohe Blue Professional** (type `105`)

The adapter logs in via Grohe’s OIDC/Keycloak flow, stores a **refresh token encrypted** in a state, and polls the Grohe cloud API on a configurable interval.

---

## Features

- Cloud login with **email/password** (initial) and automatic **token refresh**
- Refresh token is persisted **encrypted** in `grohe-smarthome.0.auth.refreshToken`
- Periodic polling of the Grohe dashboard:
  - discovers locations → rooms → appliances
  - creates ioBroker devices/channels/states automatically
- Device data exposed as readable states (measurements, status, notifications)
- **Controls** (writable states) for:
  - Sense Guard valve open/close
  - Sense Guard start pressure measurement
  - Grohe Blue dispensing + CO₂/filter resets
- Optional creation of a `.raw` channel with all raw measurement fields

---

## Configuration

In the adapter instance settings:

- **Email**: your Grohe/Ondus account email
- **Password**: your Grohe/Ondus account password
- **Poll interval (seconds)**: polling interval in seconds  
  - minimum is **30 seconds**
  - default fallback is **300 seconds**
- **Raw states** (`rawStates`): if enabled, the adapter writes all measurement fields to `<device>.raw.*`

> Note: The adapter does **not** store the refresh token in the config because writing the config triggers an instance restart. Instead it is stored in a state (`auth.refreshToken`) and encrypted using ioBroker’s built-in encryption helpers.

---

## Authentication and Token Handling

On startup:

1. The adapter reads the stored refresh token from `auth.refreshToken`.
2. If available, it tries to refresh tokens.
3. If refresh fails or no token exists, it performs a full login with email/password.
4. The obtained refresh token is stored **encrypted** (`enc:<...>`) in `auth.refreshToken`.

If an old (unencrypted) token is found, the adapter automatically migrates it to encrypted storage.

The HTTP client automatically retries requests once if it receives **401 Unauthorized** (refresh + retry).

---

## Device Structure in ioBroker

Devices are created under the adapter namespace:

```
grohe-smarthome.0.<applianceId>.*
```

Each appliance becomes a **device object**, with additional channels depending on type.

### Common states for all devices

#### Status channel

```
<applianceId>.status.online                (boolean)
<applianceId>.status.updateAvailable       (boolean)
<applianceId>.status.wifiQuality           (number, if available)
```

#### Notifications channel (latest entry)

```
<applianceId>.notifications.latestMessage       (string)
<applianceId>.notifications.latestTimestamp     (string/date)
<applianceId>.notifications.latestCategory      (number)
<applianceId>.notifications.latestCategoryName  (string)
```

Notification categories are mapped like:

- `10` Information
- `20` Warning
- `30` Alarm
- `40` WebURL

---

## Grohe Sense (type 101)

States:

```
<applianceId>.temperature        (°C)
<applianceId>.humidity           (%)
<applianceId>.battery            (%)
<applianceId>.lastMeasurement    (date string)
```

Optional raw data (if enabled):

```
<applianceId>.raw.*
```

---

## Grohe Sense Guard (type 103)

States:

```
<applianceId>.temperature        (°C, water temp)
<applianceId>.flowRate           (l/h)
<applianceId>.pressure           (bar)
<applianceId>.lastMeasurement    (date string)
<applianceId>.valveOpen          (boolean indicator)
```

Consumption channel:

```
<applianceId>.consumption.daily
<applianceId>.consumption.averageDaily
<applianceId>.consumption.averageMonthly
<applianceId>.consumption.totalWaterConsumption   (calculated, see below)
<applianceId>.consumption.lastWaterConsumption
<applianceId>.consumption.lastMaxFlowRate
```

> **Note on `totalWaterConsumption`:** The Grohe dashboard API does not reliably provide total water consumption. The adapter therefore calculates it from the `/data/aggregated` endpoint – similar to the [HA Grohe integration](https://github.com/Flo-Schilli/ha-grohe_smarthome). Once per day the historical total (from installation date, grouped by year) is fetched; every 5th poll the current day's consumption is added on top.

Pressure measurement channel (only if the API provides data; may be missing initially):

```
<applianceId>.pressureMeasurement.dropOfPressure   (bar)
<applianceId>.pressureMeasurement.isLeakage        (boolean)
<applianceId>.pressureMeasurement.leakageLevel     (string)
<applianceId>.pressureMeasurement.startTime        (date string)
```

Controls (writable “button” states, auto-reset back to `false` after execution):

```
<applianceId>.controls.valveOpen                  (boolean button)
<applianceId>.controls.valveClose                 (boolean button)
<applianceId>.controls.startPressureMeasurement   (boolean button)
```

---

## Grohe Blue Home / Professional (type 104 / 105)

States:

```
<applianceId>.remainingCo2                (%)
<applianceId>.remainingFilter             (%)
<applianceId>.remainingCo2Liters          (l)
<applianceId>.remainingFilterLiters       (l)

<applianceId>.cyclesCarbonated
<applianceId>.cyclesStill

<applianceId>.operatingTime               (min)
<applianceId>.pumpRunningTime             (min)
<applianceId>.maxIdleTime                 (min)
<applianceId>.timeSinceRestart            (min)

<applianceId>.waterRunningCarbonated      (min)
<applianceId>.waterRunningMedium          (min)
<applianceId>.waterRunningStill           (min)

<applianceId>.dateCleaning                (date string)
<applianceId>.dateCo2Replacement          (date string)
<applianceId>.dateFilterReplacement       (date string)
<applianceId>.lastMeasurement             (date string)

<applianceId>.cleaningCount
<applianceId>.filterChangeCount
<applianceId>.powerCutCount
<applianceId>.pumpCount
```

Controls:

```
<applianceId>.controls.tapType            (number)  1=still, 2=medium, 3=carbonated
<applianceId>.controls.tapAmount          (number)  amount in ml (multiples of 50 recommended)
<applianceId>.controls.dispenseTrigger    (boolean button)

<applianceId>.controls.resetCo2           (boolean button)
<applianceId>.controls.resetFilter        (boolean button)
```

When `dispenseTrigger` is set to `true`, the adapter reads `tapType` and `tapAmount`, triggers dispensing, and resets `dispenseTrigger` back to `false`.

> **Note on measurement freshness:** Unlike Sense/Guard devices, Grohe Blue does **not** push measurement data automatically. The adapter periodically sends a `get_current_measurement` command to the device (every 3rd poll cycle) to trigger a data refresh. After starting the adapter, it may take 1 poll cycles before current values (e.g. `remainingFilter`, `remainingCo2`) are displayed.

---

## Polling and Discovery

- The adapter polls the endpoint `/dashboard` and iterates:
  - `locations[] → rooms[] → appliances[]`
- Appliances with `registration_complete === false` are skipped.

### Tiered polling strategy

To minimize API calls and avoid HTTP 403 rate-limiting errors, not every endpoint is called on every poll cycle. The adapter uses a **poll counter** and fetches additional data at different intervals:

| Endpoint | Frequency | Applies to | Reason |
|---|---|---|---|
| `/dashboard` | **every** poll | All | Core sensor data (temperature, flow, pressure, …) |
| `/status` | every **5th** poll | All | Online/WiFi/update status changes slowly |
| `/command` (read) | every **3rd** poll | Sense Guard | Valve state (also read back immediately after commands) |
| `/command` (`get_current_measurement`) | every **3rd** poll | Blue | Triggers a fresh measurement on the device |
| `/data/aggregated` (today) | every **5th** poll | Sense Guard | Current day's water consumption for totalWaterConsumption |
| `/data/aggregated` (historical) | **once per day** | Sense Guard | Historical base for totalWaterConsumption |
| `/pressuremeasurement` | every **10th** poll | Sense Guard | Only changes after a manual pressure test |

> **Tip:** If you still encounter HTTP 403 errors, increase the polling interval in the adapter settings. The Grohe API has rate limits.

### Exponential backoff

On polling errors the adapter automatically increases the polling interval:

1. Each consecutive failure **doubles** the interval (e.g. 300 → 600 → 1200 → 2400 → 3600s).
2. Maximum backoff: **1 hour**.
3. After reaching 1 hour: the adapter pauses until **12:00** (noon) or, if already past noon, until **00:00** (midnight). This avoids unnecessary API traffic for the rest of the day.
4. After a **successful** poll the interval resets to the configured value.

---

## Error Handling Notes

- If polling fails, `info.connection` is set to `false`.
- Special handling for **HTTP 403**: the adapter logs a message suggesting to verify that the Grohe app/account is still working/active.
With every failed Try the Timout will increased till max. 1h.
- Token refresh is automatic on **401** and then the request is retried once.
- All error catches log at **warn** level (except expected HTTP 404 for pressure measurements which stays at debug).

---

## Development Notes

Core modules:

- `main.js`: ioBroker adapter logic (objects, polling, state updates, command handling)
- `lib/groheClient.js`: Grohe API wrapper with authenticated requests
- `lib/auth.js`: OAuth/Keycloak login + refresh handling (manual redirect chain, cookie jar)

---
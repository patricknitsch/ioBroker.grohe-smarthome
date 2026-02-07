![Logo](admin/grohe-smarthome.png)
# ioBroker.grohe-smarthome

[![NPM version](https://img.shields.io/npm/v/iobroker.grohe-smarthome.svg)](https://www.npmjs.com/package/iobroker.grohe-smarthome)
[![Downloads](https://img.shields.io/npm/dm/iobroker.grohe-smarthome.svg)](https://www.npmjs.com/package/iobroker.grohe-smarthome)
![Number of Installations](https://iobroker.live/badges/grohe-smarthome-installed.svg)
![Current version in stable repository](https://iobroker.live/badges/grohe-smarthome-stable.svg)

[![NPM](https://nodei.co/npm/iobroker.grohe-smarthome.png?downloads=true)](https://nodei.co/npm/iobroker.grohe-smarthome/)

**Tests:** ![Test and Release](https://github.com/patricknitsch/ioBroker.grohe-smarthome/workflows/Test%20and%20Release/badge.svg)

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
<applianceId>.consumption.totalWaterConsumption
<applianceId>.consumption.lastWaterConsumption
<applianceId>.consumption.lastMaxFlowRate
```

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

---

## Polling and Discovery

- The adapter polls the endpoint `/dashboard` and iterates:
  - `locations[] → rooms[] → appliances[]`
- Appliances with `registration_complete === false` are skipped.
- For each appliance it also tries to fetch:
  - `/status` (online/update/wifi)
  - `/command` (used for Sense Guard `valve_open`)
  - `/pressuremeasurement` (Sense Guard; may return HTTP 404 if never executed)

---

## Error Handling Notes

- If polling fails, `info.connection` is set to `false`.
- Special handling for **HTTP 403**: the adapter logs a message suggesting to verify that the Grohe app/account is still working/active.
- Token refresh is automatic on **401** and then the request is retried once.

---

## Development Notes

Core modules:

- `main.js`: ioBroker adapter logic (objects, polling, state updates, command handling)
- `lib/groheClient.js`: Grohe API wrapper with authenticated requests
- `lib/auth.js`: OAuth/Keycloak login + refresh handling (manual redirect chain, cookie jar)

---

## Changelog
<!--
	Placeholder for the next version (at the beginning of the line):
	### **WORK IN PROGRESS**
-->
### 0.1.1 (2026-02-07) 
* (claude)Rate limiting awareness (HTTP 403 handling)
* (claude)Immediate state readback after commands
* (claude)Optimized polling with tiered API call frequency

### 0.1.0 (2026-02-07)
* (patricknitsch) initial release
* (claude)OAuth login via Grohe Keycloak with automatic token refresh
* (claude)Support for Sense, Sense Guard, Blue Home, Blue Professional
* (claude)Encrypted refresh token storage
* (claude)Optional raw measurement data states
* (claude)i18n support (EN/DE) for admin UI

## License
MIT License

Copyright (c) 2026 patricknitsch <patricknitsch@web.de>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

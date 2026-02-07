![Logo](admin/grohe_smarthome.png)
# ioBroker.grohe-smarthome

[![NPM version](https://img.shields.io/npm/v/iobroker.grohe-smarthome.svg)](https://www.npmjs.com/package/iobroker.grohe-smarthome)
[![Downloads](https://img.shields.io/npm/dm/iobroker.grohe-smarthome.svg)](https://www.npmjs.com/package/iobroker.grohe-smarthome)
![Number of Installations](https://iobroker.live/badges/grohe-smarthome-installed.svg)
![Current version in stable repository](https://iobroker.live/badges/grohe-smarthome-stable.svg)

[![NPM](https://nodei.co/npm/iobroker.grohe-smarthome.png?downloads=true)](https://nodei.co/npm/iobroker.grohe-smarthome/)

**Tests:** ![Test and Release](https://github.com/patricknitsch/ioBroker.grohe-smarthome/workflows/Test%20and%20Release/badge.svg)

## Grohe Smarthome adapter for ioBroker

Connect to Grohe Sense / Sense Guard / Blue Home / Blue Professional systems via the Grohe cloud API.

## Supported devices

| Device | Type | Data points |
|--------|------|-------------|
| **Grohe Sense** | Water sensor (101) | Temperature, humidity, battery, notifications |
| **Grohe Sense Guard** | Water controller (103) | Temperature, flow rate, pressure, consumption (daily / avg / total), valve state, pressure measurement, notifications, controls |
| **Grohe Blue Home** | Water system (104) | CO2/filter remaining, cycles, operating times, water dispensing, cleaning/replacement dates, counters, notifications, controls |
| **Grohe Blue Professional** | Water system (105) | Same as Blue Home |

## Features

- **OAuth login** via Grohe Keycloak with automatic token refresh
- **Encrypted token storage** – refresh token is stored encrypted in ioBroker state
- **Dashboard-based polling** – single API call returns all device data (measurements, consumption, notifications)
- **Optimized API usage** – extra endpoints (status, command, pressure measurement) are fetched at reduced frequency to avoid rate limiting
- **Immediate command readback** – after sending commands (e.g. valve open/close), the current state is re-read from the API immediately
- **Optional raw data states** – enable via adapter settings to see all measurement fields as-is from the API
- **Controls** – valve open/close, start pressure measurement, water dispensing (Blue), CO2/filter reset (Blue)

## Installation

1. Install the adapter via the ioBroker admin interface
2. Enter your Grohe account email and password in the adapter settings
3. Start the adapter

## Configuration

| Setting | Description | Default |
|---------|-------------|---------|
| **Email** | Grohe account email address | – |
| **Password** | Grohe account password (stored encrypted) | – |
| **Polling interval** | Interval in seconds between data refreshes | 300 |
| **Raw states** | Create raw measurement data points for debugging | off |

### Polling interval and rate limiting

The Grohe cloud API uses HTTP 403 responses for rate limiting (see [ha-grohe_smarthome#30](https://github.com/Flo-Schilli/ha-grohe_smarthome/issues/30)). To minimize API calls, this adapter uses a tiered polling strategy:

| Data | Source | Frequency |
|------|--------|-----------|
| Sensor values, consumption, notifications | Dashboard API | Every poll |
| Online status, WiFi quality, updates | Status API | Every 5th poll |
| Valve state (Guard) | Command API | Every 3rd poll |
| Pressure measurement (Guard) | Pressure API | Every 10th poll |

**Recommendation:** Keep the polling interval at **300 seconds or higher** to avoid 403 errors. If you see 403 errors, increase the interval. The Grohe app may also be affected – check if it is working correctly.

## Data points

### Grohe Sense

| State | Description | Unit |
|-------|-------------|------|
| `temperature` | Ambient temperature | °C |
| `humidity` | Ambient humidity | % |
| `battery` | Battery level | % |
| `lastMeasurement` | Timestamp of last measurement | – |
| `status.online` | Device online | – |
| `status.updateAvailable` | Firmware update available | – |
| `status.wifiQuality` | WiFi signal quality | – |
| `notifications.*` | Latest notification (message, timestamp, category) | – |

### Grohe Sense Guard

| State | Description | Unit |
|-------|-------------|------|
| `temperature` | Water temperature | °C |
| `flowRate` | Current water flow rate | l/h |
| `pressure` | Current water pressure | bar |
| `valveOpen` | Valve open state (from command endpoint) | – |
| `consumption.daily` | Daily water consumption | l |
| `consumption.averageDaily` | Average daily consumption | l |
| `consumption.averageMonthly` | Average monthly consumption | l |
| `consumption.totalWaterConsumption` | Total water consumption | l |
| `consumption.lastWaterConsumption` | Last withdrawal amount | l |
| `consumption.lastMaxFlowRate` | Last max flow rate | l/h |
| `pressureMeasurement.dropOfPressure` | Pressure drop during test | bar |
| `pressureMeasurement.isLeakage` | Leakage detected | – |
| `pressureMeasurement.leakageLevel` | Leakage severity level | – |
| `pressureMeasurement.startTime` | Measurement timestamp | – |
| `controls.valveOpen` | Open valve (button) | – |
| `controls.valveClose` | Close valve (button) | – |
| `controls.startPressureMeasurement` | Start pressure test (button) | – |

### Grohe Blue Home / Professional

| State | Description | Unit |
|-------|-------------|------|
| `remainingCo2` | Remaining CO2 | % |
| `remainingFilter` | Remaining filter | % |
| `remainingCo2Liters` / `remainingFilterLiters` | Remaining in liters | l |
| `cyclesCarbonated` / `cyclesStill` | Open/close cycles | – |
| `operatingTime` | Total operating time | min |
| `pumpRunningTime` | Pump running time | min |
| `waterRunningCarbonated` / `Medium` / `Still` | Water running time per type | min |
| `dateCleaning` | Last cleaning date | – |
| `dateCo2Replacement` / `dateFilterReplacement` | Last replacement dates | – |
| `cleaningCount` / `filterChangeCount` / `powerCutCount` / `pumpCount` | Counters | – |
| `controls.tapType` | Water type (1=still, 2=medium, 3=carbonated) | – |
| `controls.tapAmount` | Dispense amount (ml, multiples of 50) | – |
| `controls.dispenseTrigger` | Start dispensing (button) | – |
| `controls.resetCo2` / `controls.resetFilter` | Reset counters (button) | – |

## Known issues

- **HTTP 403 errors** – The Grohe API uses 403 for rate limiting, not just permission errors. If you see this error, increase the polling interval. The same issue affects the Grohe mobile app ([reference](https://github.com/Flo-Schilli/ha-grohe_smarthome/issues/30)).
- **Pressure measurement 404** – Returns HTTP 404 if no pressure test has been executed yet. This is normal and handled gracefully.

## Changelog
<!--
	Placeholder for the next version (at the beginning of the line):
	### **WORK IN PROGRESS**
-->

### **WORK IN PROGRESS**
* (patricknitsch) initial release
* OAuth login via Grohe Keycloak with automatic token refresh
* Support for Sense, Sense Guard, Blue Home, Blue Professional
* Encrypted refresh token storage
* Optimized polling with tiered API call frequency
* Immediate state readback after commands
* Optional raw measurement data states
* Rate limiting awareness (HTTP 403 handling)
* i18n support (EN/DE) for admin UI

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

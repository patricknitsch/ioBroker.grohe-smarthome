# Older changes
## 0.4.0 (2026-05-05)
* (copilot) Add Notification Manager

## 0.3.4 (2026-05-03)
* (copilot) Adapter requires node.js >= 22 now
* (copilot) Update Dependencies

## 0.3.3 (2026-03-25)

* (patricknitsch) Clamp tapAmount between 50 and 2000 ml.

## 0.3.2 (2026-03-21)

* (copilot) Update Admin Tap for Blue systems
* (patricknitsch) Fix Isues from RepoChecker

## 0.3.1 (2026-03-18)
* (claude/patricknitsch) Fix admin tab controls not triggered after confirmation – replace native `confirm()` with custom modal dialog (works inside ioBroker iframe)
* (claude/patricknitsch) Fix 4 wrong state IDs in admin tab (Close Valve, Pressure Measurement, Reset CO₂, Reset Filter)

## 0.3.0 (2026-03-18)

* (claude/patricknitsch) Add card-based device overview tab with controls
* (claude/patricknitsch) Add Valve, Pressure Measurement and Dispense controls in admin tab
* (claude/patricknitsch) Disable controls when device is offline
* (claude/patricknitsch) Adjust color scheme in admin tab (white/black based on light/dark mode)
* (patricknitsch) Update Packages

## 0.2.6 (2026-03-11)

* (claude/patricknitsch) Fix measurement "Filter" for Blue Systems
* (claude/patricknitsch) Fix permanent dispense without Trigger

## 0.2.5 (2026-02-26)

* (patricknitsch) Update Admin Package

## 0.2.4 (2026-02-25)

* (patricknitsch) Fix Points for Latest Repo
* (patricknitsch) Update Packages

## 0.2.3 (2026-02-15)

* (claude) Fix no correct messages

## 0.2.2 (2026-02-12)
 * (claude) Fix Problem with jsonConfig and Interval

## 0.2.1 (2026-02-11)
* (patricknitsch) Change Log for measurement

## 0.2.0 (2026-02-10)

* (claude) Extend Error Handling for noon and midnight

## 0.1.7 (2026-02-09)

* (patricknitsch) Update Error Handling
* (patricknitsch) Update Readme

## 0.1.6 (2026-02-09)

* (patricknitsch) Changed Loglevel
* (claude) Update Error Handling -> increase Try-Timeouts

## 0.1.5 (2026-02-09)

* (patricknitsch) Update Dependencies

## 0.1.4 (2026-02-09)

* (claude) Fix wrong value for Grohe Blue remainingFilter
* (claude) Update Readme

## 0.1.3 (2026-02-08)

* (claude) Fix null of Total Consumption
* (claude) Update Readme

## 0.1.2 (2026-02-07)

* (patricknitsch) Update Readme and Translations

## 0.1.1 (2026-02-07) 
* (claude) Rate limiting awareness (HTTP 403 handling)
* (claude) Immediate state readback after commands
* (claude) Optimized polling with tiered API call frequency

## 0.1.0 (2026-02-07)
* (patricknitsch) initial release
* (claude) OAuth login via Grohe Keycloak with automatic token refresh
* (claude) Support for Sense, Sense Guard, Blue Home, Blue Professional
* (claude) Encrypted refresh token storage
* (claude) Optional raw measurement data states
* (claude) i18n support (EN/DE) for admin UI

[Older changelogs can be found there](CHANGELOG_OLD.md)

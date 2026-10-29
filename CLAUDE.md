# CLAUDE.md

Guidelines for working on **ioBroker.grohe-smarthome**, an ioBroker adapter for the Grohe Smarthome / Ondus cloud (Sense, Sense Guard, Blue Home, Blue Professional). Concepts follow the Home Assistant integration [ha-grohe_smarthome](https://github.com/Flo-Schilli/ha-grohe_smarthome). When porting from it, reference the HA version and file in comments and the PR.

## Project layout

| Path | Purpose |
|---|---|
| `main.js` | Adapter lifecycle (`onReady`, `onUnload`, `onStateChange`, `onMessage`), polling, state handling |
| `lib/auth.js` | OIDC/Keycloak login and token refresh |
| `lib/groheClient.js` | Grohe API client (authenticated requests, token renewal, endpoints) |
| `lib/waterConsumptionTracker.js` | Persistent total water consumption of the Sense Guard |
| `lib/device-manager.js` | Device Manager UI (`@iobroker/dm-utils`) |
| `lib/notificationManager.js`, `lib/notificationMessages.js` | Push notifications and their localized texts |
| `lib/apiDump.js` | Raw API structure dump for diagnostics |
| `admin/jsonConfig.json`, `admin/i18n/*.json` | Admin UI and its translations |
| `docs/en/README.md`, `docs/de/README.md` | User documentation |
| `README.md` | Overview and changelog |
| `io-package.json` | Adapter metadata, `news` (maintained by the release script) |

## Code structure

- **Modular:** keep `main.js` focused on the adapter lifecycle and wiring. New self-contained logic goes into its own module under `lib/`, e.g. API calls, calculations or state machines. Example: `lib/waterConsumptionTracker.js`.
- **Testable modules:** inject dependencies instead of reaching into the adapter. Pass the logger, fetch functions, load/save callbacks and the clock (`today`) in, so the logic can be unit-tested without ioBroker or network.
- **API access only through `GroheClient`.** Don't call axios directly from `main.js`.
- **Timers:** use `this.setTimeout` / `this.clearTimeout` from the adapter, never the global ones. Clear them in `onUnload`.
- **Dates:** use local dates (`_localDateStr`) for Grohe API date parameters, never `toISOString()`. Do date math on `YYYY-MM-DD` strings in UTC so DST can't shift a day.
- **Error handling:**
  - A failing appliance must not abort the poll of the others.
  - A failing optional request (consumption, pressure, …) must not break the core states.
  - Keep the last known value instead of writing 0 or empty values.
- **Rate limits:** Grohe answers too frequent requests with HTTP 403/429.
  - Every new request must fit the polling strategy (see "Polling Strategy" in the docs). Fetch slowly changing data only every n-th poll or once a day.
  - Never retry in tight loops.
- **Secrets:** never log tokens, passwords or full email addresses. Mask them like `_maskToken` / the email masking in `onReady`. The refresh token is stored encrypted in the state `auth.refreshToken`, never in the config, because writing the config restarts the adapter.
- **Style:**
  - Match the surrounding code: tabs, single quotes, JSDoc on methods.
  - Comments explain *why*, not *what*.
  - Code, comments, log messages and commit messages are in English.

## States and objects

- Create states through the helpers `_setNum`, `_setBool`, `_setStr`, `_ensureState`, `_ensureWritableBool` and `_ensureWritableNum`. Use proper ioBroker roles, e.g. `value.fill` for percentages, not `value.battery`.
- Writable states: react only to `ack: false` in `onStateChange`, and confirm with `ack: true`.
- Renaming or removing states breaks users' scripts and visualisations. Avoid it, or document it clearly in the changelog.

## Tests and checks

Run all of these before every commit or push. They must pass:

```bash
npm run lint      # ESLint + Prettier (must be clean; `npx eslint --fix <file>` for formatting)
npm test          # unit tests (*.test.js) + package tests
```

- `npm run check` (tsc) currently reports errors in the test files only, because the mocha types are missing. It must not report **new** errors in `main.js` or `lib/`.
- Every new module or bug fix gets unit tests. Put them next to the code as `lib/<module>.test.js` (mocha + chai). See `lib/groheClient.test.js` and `lib/waterConsumptionTracker.test.js`.
- Tests must not use the network or real credentials. Mock `client.request`, `client.http` or the injected callbacks.
- Integration tests (`npm run test:integration`) run in CI on Node 22/24/26 for Linux, Windows and macOS.

## Documentation

Every user-visible change needs:

1. **Changelog entry in `README.md`** under the `### **WORK IN PROGRESS**` heading. If the heading doesn't exist yet, add it directly below the placeholder comment in the `## Changelog` section.
   - Format: `* (patricknitsch) <short description in English>`.
   - Don't edit released versions, and don't edit `io-package.json` `news` or the version numbers. The release script (`npm run release`) does that.
2. **Docs in both languages**, `docs/en/README.md` **and** `docs/de/README.md`. Keep them in sync:
   - new or changed states
   - polling strategy table
   - authentication
   - error handling
   - file list
3. **Translations:**
   - New admin texts go into all files under `admin/i18n/` (`npm run translate` helps).
   - New notification texts go into every language in `lib/notificationMessages.js`.

## Git and pull requests

- Never commit to `main` directly. Work on a feature branch (`feat/…`, `fix/…`, `chore/…`).
- When the work is done and all checks pass, push the branch and **open the PR automatically**, without asking first.
- PR title: short and fitting, **at most two words**, e.g. `Robust Login`, `Consumption Tracker`, `Blue Fix`.
- One topic per PR. Describe in the PR what changed, why, and how it was tested, including whether it was tested against the live Grohe API.
- Keep commit messages descriptive, in English, imperative mood.

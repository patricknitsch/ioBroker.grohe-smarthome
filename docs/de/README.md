# ioBroker Grohe Smarthome Adapter

Dieser Adapter verbindet ioBroker mit der **Grohe Smarthome / Ondus**-Cloud und stellt Grohe-Geräte als Zustände (und einige Steuerungen) in ioBroker zur Verfügung.

Unterstützt werden:

- **Grohe Sense** (Typ `101`)
- **Grohe Sense Guard** (Typ `103`)
- **Grohe Blue Home** (Typ `104`)
- **Grohe Blue Professional** (Typ `105`)

Der Adapter meldet sich über den OIDC/Keycloak-Login von Grohe an, speichert ein **Refresh-Token verschlüsselt** in einem State und fragt die Grohe-Cloud-API in einem konfigurierbaren Intervall ab.

---

## Funktionen

- Cloud-Login mit **E-Mail/Passwort** (initial) und automatischer **Token-Erneuerung**
- Refresh-Token wird **verschlüsselt** in `grohe-smarthome.0.auth.refreshToken` gespeichert
- Periodisches Abfragen des Grohe-Dashboards:
  - erkennt Standorte → Räume → Geräte
  - erstellt ioBroker-Geräte/Kanäle/States automatisch
- Gerätedaten als lesbare States (Messwerte, Status, Benachrichtigungen)
- **Steuerungen** (beschreibbare States) für:
  - Sense Guard Ventil öffnen/schließen
  - Sense Guard Druckmessung starten
  - Grohe Blue Zapfen + CO₂-/Filter-Resets
- Optionale Erstellung eines `.raw`-Kanals mit allen Roh-Messwerten

---

## Konfiguration

In den Instanz-Einstellungen des Adapters:

- **E-Mail**: E-Mail-Adresse deines Grohe/Ondus-Kontos
- **Passwort**: Passwort deines Grohe/Ondus-Kontos
- **Abfrageintervall (Sekunden)**: Polling-Intervall in Sekunden  
  - Minimum **30 Sekunden**
  - Standard-Fallback **300 Sekunden**
- **Raw-States** (`rawStates`): Wenn aktiviert, schreibt der Adapter alle Messfelder nach `<device>.raw.*`

> Hinweis: Der Adapter speichert das Refresh-Token **nicht** in der Konfiguration, da jede Konfigurationsänderung einen Neustart der Instanz auslöst. Stattdessen wird es in einem State (`auth.refreshToken`) gespeichert und mit den integrierten ioBroker-Verschlüsselungsfunktionen verschlüsselt.

---

## Authentifizierung und Token-Handling

Beim Start:

1. Der Adapter liest das gespeicherte Refresh-Token aus `auth.refreshToken`.
2. Falls vorhanden, wird versucht, die Tokens zu erneuern.
3. Schlägt das Refresh fehl oder existiert kein Token, erfolgt ein kompletter Login mit E-Mail/Passwort.
4. Das erhaltene Refresh-Token wird **verschlüsselt** (`enc:<...>`) in `auth.refreshToken` gespeichert.

Wird ein altes (unverschlüsseltes) Token gefunden, migriert der Adapter dieses automatisch in eine verschlüsselte Speicherung.

Der HTTP-Client wiederholt Anfragen automatisch einmal, wenn ein **401 Unauthorized** auftritt (Token-Refresh + erneuter Request).

---

## Gerätestruktur in ioBroker

Geräte werden unterhalb des Adapter-Namespaces erstellt:

```
grohe-smarthome.0.<applianceId>.*
```

Jedes Gerät wird als **Device-Objekt** angelegt, mit zusätzlichen Kanälen je nach Typ.

### Gemeinsame States für alle Geräte

#### Status-Kanal

```
<applianceId>.status.online                (boolean)
<applianceId>.status.updateAvailable       (boolean)
<applianceId>.status.wifiQuality           (number, falls verfügbar)
```

#### Benachrichtigungen-Kanal (letzter Eintrag)

```
<applianceId>.notifications.latestMessage       (string)
<applianceId>.notifications.latestTimestamp     (string/date)
<applianceId>.notifications.latestCategory      (number)
<applianceId>.notifications.latestCategoryName  (string)
```

Zuordnung der Benachrichtigungskategorien:

- `10` Information
- `20` Warnung
- `30` Alarm
- `40` Web-URL

---

## Grohe Sense (Typ 101)

States:

```
<applianceId>.temperature        (°C)
<applianceId>.humidity           (%)
<applianceId>.battery            (%)
<applianceId>.lastMeasurement    (Datumsstring)
```

Optionale Rohdaten (falls aktiviert):

```
<applianceId>.raw.*
```

---

## Grohe Sense Guard (Typ 103)

States:

```
<applianceId>.temperature        (°C, Wassertemperatur)
<applianceId>.flowRate           (l/h)
<applianceId>.pressure           (bar)
<applianceId>.lastMeasurement    (Datumsstring)
<applianceId>.valveOpen          (boolean, Anzeige)
```

Verbrauchs-Kanal:

```
<applianceId>.consumption.daily
<applianceId>.consumption.averageDaily
<applianceId>.consumption.averageMonthly
<applianceId>.consumption.totalWaterConsumption
<applianceId>.consumption.lastWaterConsumption
<applianceId>.consumption.lastMaxFlowRate
```

Druckmessungs-Kanal (nur wenn die API Daten liefert; kann anfangs fehlen):

```
<applianceId>.pressureMeasurement.dropOfPressure   (bar)
<applianceId>.pressureMeasurement.isLeakage        (boolean)
<applianceId>.pressureMeasurement.leakageLevel     (string)
<applianceId>.pressureMeasurement.startTime        (Datumsstring)
```

Steuerungen (beschreibbare „Button“-States, werden nach Ausführung automatisch wieder auf `false` gesetzt):

```
<applianceId>.controls.valveOpen                  (boolean button)
<applianceId>.controls.valveClose                 (boolean button)
<applianceId>.controls.startPressureMeasurement   (boolean button)
```

---

## Grohe Blue Home / Professional (Typ 104 / 105)

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

<applianceId>.dateCleaning                (Datumsstring)
<applianceId>.dateCo2Replacement          (Datumsstring)
<applianceId>.dateFilterReplacement       (Datumsstring)
<applianceId>.lastMeasurement             (Datumsstring)

<applianceId>.cleaningCount
<applianceId>.filterChangeCount
<applianceId>.powerCutCount
<applianceId>.pumpCount
```

Steuerungen:

```
<applianceId>.controls.tapType            (number)  1=still, 2=medium, 3=sprudel
<applianceId>.controls.tapAmount          (number)  Menge in ml (Vielfache von 50 empfohlen)
<applianceId>.controls.dispenseTrigger    (boolean button)

<applianceId>.controls.resetCo2           (boolean button)
<applianceId>.controls.resetFilter        (boolean button)
```

Wenn `dispenseTrigger` auf `true` gesetzt wird, liest der Adapter `tapType` und `tapAmount`, startet den Zapfvorgang und setzt `dispenseTrigger` anschließend wieder auf `false`.

---

## Polling und Geräteerkennung

- Der Adapter fragt den Endpunkt `/dashboard` ab und durchläuft:
  - `locations[] → rooms[] → appliances[]`
- Geräte mit `registration_complete === false` werden übersprungen.
- Für jedes Gerät wird zusätzlich versucht abzurufen:
  - `/status` (Online-Status / Update / WLAN)
  - `/command` (u. a. für Sense Guard `valve_open`)
  - `/pressuremeasurement` (Sense Guard; kann HTTP 404 liefern, wenn noch nie ausgeführt)

---

## Hinweise zur Fehlerbehandlung

- Wenn das Polling fehlschlägt, wird `info.connection` auf `false` gesetzt.
- Spezielle Behandlung für **HTTP 403**: Der Adapter protokolliert einen Hinweis, dass überprüft werden sollte, ob die Grohe-App bzw. das Konto noch aktiv und funktionsfähig ist.
- Token-Refresh erfolgt automatisch bei **401**, anschließend wird die Anfrage einmal wiederholt.

---

## Hinweise zur Entwicklung

Zentrale Module:

- `main.js`: ioBroker-Adapterlogik (Objekte, Polling, State-Updates, Befehle)
- `lib/groheClient.js`: Grohe-API-Wrapper mit authentifizierten Requests
- `lib/auth.js`: OAuth/Keycloak-Login und -Refresh (manuelle Redirect-Kette, Cookie-Jar)

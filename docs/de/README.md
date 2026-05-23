# ioBroker Grohe Smarthome Adapter

Dieser Adapter verbindet ioBroker mit der **Grohe Smarthome / Ondus**-Cloud und stellt Grohe-Geräte als Zustände (und einige Steuerungen) in ioBroker zur Verfügung.

Unterstützt werden:

- **Grohe Sense** (Typ `101`)
- **Grohe Sense Guard** (Typ `103`)
- **Grohe Blue Home** (Typ `104`)
- **Grohe Blue Professional** (Typ `105`)

Der Adapter meldet sich über den OIDC/Keycloak-Login von Grohe an, speichert ein **Refresh-Token verschlüsselt** in einem State und fragt die Grohe-Cloud-API in einem konfigurierbaren Intervall ab.

---

## Device Manager

Der Adapter nutzt den ioBroker **Device Manager** und liefert keinen `admin/tab.html` mehr.

Wähle im Device Manager ein registriertes Grohe-Gerät aus, um die zugehörige **Gerätekachel** zu öffnen.

### Kachel-Inhalte je Gerätetyp

| Gerätetyp | Status-Icons | Kachel-Werte |
|---|---|---|
| **Grohe Sense** | Online, WLAN-Qualität, Batterie | Temperatur, Luftfeuchtigkeit, Batterie |
| **Grohe Sense Guard** | Online, WLAN-Qualität, Ventil-Status | Wassertemperatur, Durchfluss, Druck, Tagesverbrauch, Ventil öffnen / schließen |
| **Grohe Blue** | Online, WLAN-Qualität | CO₂ verbleibend, Filter verbleibend, Letzte Messung |

### Detail-Tabs

Jedes Gerät bietet bei Klick auf die Kachel zwei Detail-Tabs:

- **Info**: allgemeine Informationen (Geräte-ID, Typ, Online, Update verfügbar, WLAN-Qualität, letzte Meldung + Zeitstempel) sowie gerätespezifische Messwerte
- **Steuerung**: Schreibaktionen und Eingabefelder (entfällt bei Grohe Sense)

Steueraktionen:

- **Grohe Sense Guard**: Ventil öffnen / schließen, Druckmessung starten
- **Grohe Blue Home / Professional**: Zapfart (Still/Medium/Sprudel), Menge (ml), Zapfen auslösen, CO₂ zurücksetzen, Filter zurücksetzen

Für Grohe Sense gibt es keine Schreib-Steuerungen (kein Steuerungstab).

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

Die Adapterkonfiguration ist in zwei Tabs aufgeteilt:

### Tab „Einstellungen“

- **E-Mail**: E-Mail-Adresse deines Grohe/Ondus-Kontos
- **Passwort**: Passwort deines Grohe/Ondus-Kontos
- **Abfrageintervall (Sekunden)**: Polling-Intervall in Sekunden  
  - Minimum **60 Sekunden**
  - Standard-Fallback **300 Sekunden**
- **Raw-States** (`rawStates`): Wenn aktiviert, schreibt der Adapter alle Messfelder nach `<device>.raw.*`

> Hinweis: Der Adapter speichert das Refresh-Token **nicht** in der Konfiguration, da jede Konfigurationsänderung einen Neustart der Instanz auslöst. Stattdessen wird es in einem State (`auth.refreshToken`) gespeichert und mit den integrierten ioBroker-Verschlüsselungsfunktionen verschlüsselt.

### Tab „Benachrichtigungen“

Aktiviere Push-Benachrichtigungen, um über Geräteereignisse informiert zu werden. Alle Meldungen werden in der in ioBroker konfigurierten Systemsprache verschickt.

#### Benachrichtigungskategorien

| # | Kategorie | Beispiele |
|---|---|---|
| 1 | **Kritische Meldungen** | Überschwemmung erkannt, Sensorfehler, Systemfehler |
| 2 | **Warnungen** | Batterie schwach, Temperatur/Luftfeuchtigkeit außerhalb des Bereichs, WLAN-Verlust, Blue Filter/CO₂ niedrig, Gerät online/offline, `latestMessage` bei `latestTimestamp`-Änderung |
| 3 | **Ventil- & Steuerungsereignisse** | Ventil geöffnet/geschlossen, Zapfvorgang |
| 4 | **Verbindungsfehler** | HTTP Polling-Fehler (z.B. HTTP 403), werden bei jedem Fehler gesendet |

> Hinweis: Verbindungsfehler (Kategorie 4) werden bei jedem einzelnen Polling-Fehler gesendet, nicht nur beim ersten. Das kann zu häufigen Meldungen führen, wenn die API dauerhaft nicht erreichbar ist. Erhöhe das Polling-Intervall, wenn du zu viele solche Benachrichtigungen erhältst.

> Hinweis zu `latestMessage` (in Kategorie 2 „Warnungen“ enthalten): Ist „Warnungen“ aktiviert, sendet der Adapter bei jeder Änderung von `latestTimestamp` eine Meldung mit dem aktuellen `latestMessage`-Text. Beim ersten Poll nach Adapterstart wird der vorhandene Stand als Basis übernommen (kein Flooding alter Meldungen). Wenn ein Gerät anfangs noch keine Notification hat und später die erste Meldung erhält, wird diese Änderung benachrichtigt.

#### Unterstützte Anbieter

Für jeden Anbieter wird die Adapter-Instanz (z.B. `telegram.0`) über ein Dropdown in der Konfiguration ausgewählt.

| Anbieter | Konfiguration |
|---|---|
| **Telegram** | Instanz; optional: Benutzer oder Chat-ID |
| **Pushover** | Instanz; optional: Titel, Gerät |
| **WhatsApp** (`whatsapp-cmb`) | Instanz; optional: Telefonnummer |
| **E-Mail** | Instanz; optional: Empfänger, Betreff |
| **Signal** (`signal-cmb`) | Instanz; optional: Telefonnummer |
| **Matrix** (`matrix-org`) | Instanz |
| **Synology Chat** | Instanz; Kanalname (erforderlich) |

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
<applianceId>.notifications.latestType          (number)
```

Zuordnung der Benachrichtigungskategorien:

- `0` Werbung
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
<applianceId>.consumption.totalWaterConsumption   (berechnet, siehe unten)
<applianceId>.consumption.lastWaterConsumption
<applianceId>.consumption.lastMaxFlowRate
```

> **Hinweis zu `totalWaterConsumption`:** Die Grohe-Dashboard-API liefert den Gesamtverbrauch nicht zuverlässig. Der Adapter berechnet ihn daher über den Endpunkt `/data/aggregated` – analog zur [HA Grohe-Integration](https://github.com/Flo-Schilli/ha-grohe_smarthome). Einmal täglich wird der historische Gesamtwert (ab Installationsdatum, gruppiert nach Jahr) abgerufen; jeden 5. Poll wird der aktuelle Tagesverbrauch hinzuaddiert.

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
<applianceId>.controls.tapAmount          (number)  Menge in ml (50–2000, Vielfache von 50)
<applianceId>.controls.dispenseTrigger    (boolean button)

<applianceId>.controls.resetCo2           (boolean button)
<applianceId>.controls.resetFilter        (boolean button)
```

Wenn `dispenseTrigger` auf `true` gesetzt wird, liest der Adapter `tapType` und `tapAmount`, startet den Zapfvorgang und setzt `dispenseTrigger` anschließend wieder auf `false`. Nach dem Zapfvorgang werden `tapType` und `tapAmount` automatisch auf `0` zurückgesetzt, um eine unbeabsichtigte Wiederverwendung der Werte in nachfolgenden Polling-Zyklen zu verhindern. Sie werden auch bei jedem Adapterstart auf `0` zurückgesetzt.

> **Hinweis zur Messdaten-Aktualität:** Anders als Sense/Guard-Geräte senden Grohe-Blue-Geräte ihre Messdaten **nicht** automatisch. Der Adapter sendet periodisch einen `get_current_measurement`-Befehl an das Gerät (jeden 3. Poll-Zyklus), um eine Datenaktualisierung auszulösen. Nach dem Senden des Befehls startet eine **Hintergrund-Verifizierung**, die den `/details`-Endpunkt alle 10 Sekunden erneut abfragt (bis zu 3 Versuche / maximal 30 Sekunden insgesamt), bis ein neuerer Messwert-Timestamp erscheint. Nach Erkennung werden alle States aktualisiert. So wird sichergestellt, dass Werte wie `remainingFilter` und `remainingCo2` die aktuellen Gerätedaten widerspiegeln. Nach dem Start des Adapters kann es 1–2 Poll-Zyklen dauern, bis aktuelle Werte angezeigt werden.

---

## Polling und Geräteerkennung

- Der Adapter fragt den Endpunkt `/dashboard` ab und durchläuft:
  - `locations[] → rooms[] → appliances[]`
- Geräte mit `registration_complete === false` werden übersprungen.

### Gestaffeltes Polling

Um die Anzahl der API-Aufrufe zu minimieren und HTTP-403-Fehler durch Rate-Limiting zu vermeiden, wird nicht bei jedem Polling-Zyklus jeder Endpunkt abgefragt. Der Adapter verwendet einen **Poll-Zähler** und ruft zusätzliche Daten in unterschiedlichen Intervallen ab:

| Endpunkt | Häufigkeit | Gilt für | Grund |
|---|---|---|---|
| `/dashboard` | **jeder** Poll | Alle | Kern-Sensordaten (Temperatur, Durchfluss, Druck, …) |
| `/status` | jeder **5.** Poll | Alle | Online-/WLAN-/Update-Status ändert sich selten |
| `/command` (lesen) | jeder **3.** Poll | Sense Guard | Ventilzustand (wird nach Befehlen sofort zurückgelesen) |
| `/command` (`get_current_measurement`) | jeder **3.** Poll | Blue | Löst eine frische Messung am Gerät aus |
| `/details` (Verifizierung) | bis zu **3×** nach Refresh | Blue | Hintergrund-Abfrage ob frische Daten angekommen sind (10s-Intervall, max. 30s gesamt) |
| `/data/aggregated` (heute) | jeder **5.** Poll | Sense Guard | Tagesverbrauch für totalWaterConsumption |
| `/data/aggregated` (historisch) | **einmal pro Tag** | Sense Guard | Historische Basis für totalWaterConsumption |
| `/pressuremeasurement` | jeder **10.** Poll | Sense Guard | Ändert sich nur nach manueller Druckmessung |

> **Tipp:** Falls weiterhin HTTP-403-Fehler auftreten, erhöhe das Polling-Intervall in den Adapter-Einstellungen. Die Grohe-API hat Rate-Limits.

### Exponentieller Backoff

Bei Polling-Fehlern erhöht der Adapter das Intervall automatisch:

1. Jeder aufeinanderfolgende Fehler **verdoppelt** das Intervall (z. B. 300 → 600 → 1200 → 2400 → 3600s).
2. Maximaler Backoff: **1 Stunde**.
3. Nach Erreichen von 1 Stunde: Der Adapter pausiert bis **12:00** (Mittag) bzw., falls bereits nach 12:00, bis **00:00** (Mitternacht). So wird unnötiger API-Verkehr für den Rest des Tages vermieden.
4. Nach einem **erfolgreichen** Poll wird das Intervall auf den konfigurierten Wert zurückgesetzt.

---

## Hinweise zur Fehlerbehandlung

- Wenn das Polling fehlschlägt, wird `info.connection` auf `false` gesetzt.
- Spezielle Behandlung für **HTTP 403**: Der Adapter protokolliert einen Hinweis, dass überprüft werden sollte, ob die Grohe-App bzw. das Konto noch aktiv und funktionsfähig ist.
Mit jedem fehlgeschlagenen Pollingversuch wird die Zeit bis zum nächsten Versuch bis max. 1h erhöht. 
- Token-Refresh erfolgt automatisch bei **401**, anschließend wird die Anfrage einmal wiederholt.
- Alle Fehler in catch-Blöcken werden auf **warn**-Stufe geloggt (außer erwartete HTTP 404 bei Druckmessungen, die auf debug bleiben).

---

## Hinweise zur Entwicklung

Zentrale Module:

- `main.js`: ioBroker-Adapterlogik (Objekte, Polling, State-Updates, Befehle, Message-Handler für Device Manager)
- `lib/device-manager.js`: Device Manager Integration (Kacheln, Tabs, Templates je Gerätetyp)
- `lib/groheClient.js`: Grohe-API-Wrapper mit authentifizierten Requests
- `lib/auth.js`: OAuth/Keycloak-Login und -Refresh (manuelle Redirect-Kette, Cookie-Jar)
- `lib/notificationManager.js`: Versendet Push-Benachrichtigungen an konfigurierte Anbieter-Instanzen
- `lib/notificationMessages.js`: Lokalisierte Benachrichtigungsvorlagen und Grohe-Benachrichtigungstyp-Texte (11 Sprachen)

# ioBroker Grohe Smarthome Adapter

Dieser Adapter verbindet ioBroker mit der **Grohe Smarthome / Ondus**-Cloud und stellt Grohe-Geräte als States und Steuerungen in ioBroker bereit.

Unterstützte Geräte:

| Gerät | Typ |
|---|---|
| **Grohe Sense** | `101` |
| **Grohe Sense Guard** | `103` |
| **Grohe Blue Home** | `104` |
| **Grohe Blue Professional** | `105` |

Der Adapter meldet sich über den OIDC/Keycloak-Login von Grohe an, speichert ein **Refresh-Token verschlüsselt** in einem State und fragt die Grohe-Cloud-API in einem konfigurierbaren Intervall ab.

Idee und Konzept stammen aus der Home-Assistant-Integration **ha-grohe_smarthome**. Besonderer Dank gilt **Flo-Schilli**.

---

## Konfiguration

Die Adapterkonfiguration ist in zwei Tabs aufgeteilt.

### Tab „Einstellungen"

| Einstellung | Beschreibung |
|---|---|
| **E-Mail** | E-Mail-Adresse des Grohe- / Ondus-Kontos |
| **Passwort** | Passwort des Grohe- / Ondus-Kontos |
| **Abfrageintervall (Sekunden)** | Polling-Intervall – Minimum **60 s**, Standard **300 s** |
| **Raw-States** | Gibt die vollständige API-Antwortstruktur ins Log aus (Diagnose). Polling stoppt nach 3 Zyklen. Option deaktivieren und Adapter neu starten für Normalbetrieb. |

> Der Adapter speichert das Refresh-Token im State `auth.refreshToken` (verschlüsselt), **nicht** in der Konfiguration. Das Schreiben der Konfiguration würde einen Neustart auslösen und den Token-Ablauf unterbrechen.

### Tab „Benachrichtigungen"

Aktiviere Push-Benachrichtigungen, um über Geräteereignisse informiert zu werden. Meldungen werden in der in ioBroker eingestellten Systemsprache verschickt.

#### Benachrichtigungskategorien

| # | Kategorie | Beispiele |
|---|---|---|
| 1 | **Kritische Meldungen** | Überschwemmung erkannt, Sensorfehler, Systemfehler |
| 2 | **Warnungen** | Batterie schwach, Temperatur / Luftfeuchtigkeit außerhalb des Bereichs, WLAN-Verlust, Gerät online / offline, Blue Filter / CO₂ niedrig |
| 3 | **Ventil- & Steuerungsereignisse** | Ventil geöffnet / geschlossen, Zapfvorgang |
| 4 | **Verbindungsfehler** | HTTP-Polling-Fehler (z. B. HTTP 403), werden bei jedem Fehler gesendet |

#### Benachrichtigungs-Icons

| Icon | Bedeutung |
|---|---|
| 🚨 | Kritischer Alarm (Grohe-Kategorie 30) |
| ⚠️ | Warnung (Grohe-Kategorie 20), Gerät offline, Polling-Fehler |
| ✅ | Gerät online, Polling wiederhergestellt |
| 🔓 | Ventil geöffnet |
| 🔒 | Ventil geschlossen |
| 💧 | Wasser gezapft |
| ℹ️ | Letzte Benachrichtigung geändert |

#### Unterstützte Anbieter

| Anbieter | Hinweise |
|---|---|
| **Telegram** | Instanz; optional Benutzer oder Chat-ID |
| **Pushover** | Instanz; optional Titel, Gerät |
| **WhatsApp** (`whatsapp-cmb`) | Instanz; optional Telefonnummer |
| **E-Mail** | Instanz; optional Empfänger, Betreff |
| **Signal** (`signal-cmb`) | Instanz; optional Telefonnummer |
| **Matrix** (`matrix-org`) | Instanz |
| **Synology Chat** | Instanz; Kanalname (erforderlich) |

---

## Device Manager

Der Adapter ist in den ioBroker **Device Manager** integriert. Wähle ein registriertes Grohe-Gerät aus, um dessen Kachel zu öffnen.

### Gerätekachel

Jede Kachel zeigt Live-Status-Indikatoren und die wichtigsten Messwerte auf einen Blick.

| Gerät | Status-Indikatoren | Kachel-Werte |
|---|---|---|
| **Grohe Sense** | Online, WLAN-Qualität, Batterie | Temperatur, Luftfeuchtigkeit, Batterie |
| **Grohe Sense Guard** | Online, WLAN-Qualität, Ventil-Warnung | Wassertemperatur, Durchfluss, Druck, Tagesverbrauch, Ventil öffnen / schließen |
| **Grohe Blue** | Online, WLAN-Qualität | CO₂ verbleibend, Filter verbleibend, Letzte Messung |

### Detailansicht (Tab „Info")

Klick auf die Kachel öffnet die Detailansicht. Der **Info**-Tab zeigt:

- Geräte-ID, Typ, Online-Status, Update verfügbar, WLAN-Qualität
- Letzte Benachrichtigung und Zeitstempel
- Gerätespezifische Messwerte (siehe Abschnitte je Gerätetyp)

### Detailansicht (Tab „Steuerung")

Der **Steuerungs**-Tab ist für Grohe Sense Guard und Grohe Blue verfügbar. Die Steuerungen sind in Funktionsgruppen aufgeteilt, jeweils durch einen Trennstrich voneinander abgegrenzt.

**Grohe Sense Guard – Steuerungs-Tab:**

| Gruppe | Steuerungen |
|---|---|
| **Ventilsteuerung** | Ventil öffnen (Button), Ventil schließen (Button) |
| **Druckmessung** | Starten (Button) – *Ventil muss geschlossen sein (siehe Hinweis)* |
| **Snooze** | Aktiv-Anzeige (nur lesen), Dauer-Eingabe (1–240 min), Snooze starten (Button), Snooze beenden (Button) |
| **Wasserlimits** | Entnahmelimit-Eingabe (0–2000 l) |
| **Bewässerungsmodus** | Startzeit (Std + min), Stoppzeit (Std + min), Aktive Tage (Mo–So), Speichern (Button) |

> **Hinweis zur Druckmessung:** Der Leitungscheck (Pipe Check) wird vom Gerät **automatisch** durchgeführt – typischerweise nachts, wenn kein Wasserfluss erkannt wird. Der Start-Button sendet den Befehl `measure_now`, den das Gerät nur ausführt, wenn das **Ventil geschlossen** ist und kein Wasser fließt. Die Ergebnisse sind immer in den `pressureMeasurement.*`-States zu sehen, unabhängig davon, ob der Test manuell oder automatisch ausgelöst wurde. Die Grohe App bietet ebenfalls keine manuelle Auslösung.

> **Hinweis zum Bewässerungsmodus:** Änderungen an einzelnen Bewässerungsfeldern (Zeiten, Tages-Schalter) werden lokal bestätigt, aber **nicht** sofort an die API gesendet. Erst durch den Button **„Bewässerung speichern"** werden alle Werte in einem einzigen API-Aufruf übertragen. So werden unnötige API-Aufrufe beim Umschalten einzelner Wochentage vermieden.

> **Hinweis zu Entnahmelimit und Bewässerungseinstellungen:** Diese Werte werden vom Grohe-API jeden 10. Poll-Zyklus gelesen (~50 Minuten bei 300 s Intervall, immer beim ersten Poll). Änderungen aus der Grohe App erscheinen innerhalb dieses Zeitfensters in ioBroker.

**Grohe Blue Home / Professional – Steuerungs-Tab:**

| Gruppe | Steuerungen |
|---|---|
| **Zapfen** | Zapfart (Still / Medium / Sprudel), Menge (ml), Zapfen (Button) |
| **Service** | CO₂ zurücksetzen (Button), Filter zurücksetzen (Button) |

---

## ioBroker-Staatsstruktur

Geräte werden unterhalb des Adapter-Namespaces angelegt:

```
grohe-smarthome.0.<applianceId>.*
```

### Gemeinsame States aller Geräte

```
<applianceId>.status.online                 boolean
<applianceId>.status.updateAvailable        boolean
<applianceId>.status.wifiQuality            number (falls verfügbar)

<applianceId>.notifications.latestMessage       string
<applianceId>.notifications.latestTimestamp     string (Datum)
<applianceId>.notifications.latestCategory      number
<applianceId>.notifications.latestCategoryName  string
<applianceId>.notifications.latestType          number
```

Grohe-Benachrichtigungskategorien: `0` Werbung · `10` Information · `20` Warnung · `30` Alarm · `40` Web-URL

---

## Grohe Sense (Typ 101)

### Messwerte

```
<applianceId>.temperature           °C
<applianceId>.humidity              %
<applianceId>.battery               %
<applianceId>.lastMeasurement       Datumsstring
```

---

## Grohe Sense Guard (Typ 103)

### Messwerte

```
<applianceId>.temperature           °C    Wassertemperatur
<applianceId>.flowRate              l/min
<applianceId>.pressure              bar
<applianceId>.lastMeasurement       Datumsstring
<applianceId>.valveOpen             boolean (Anzeige – nur lesbar)
```

### Verbrauchs-Kanal

```
<applianceId>.consumption.daily                  l
<applianceId>.consumption.averageDaily           l
<applianceId>.consumption.averageMonthly         l
<applianceId>.consumption.totalWaterConsumption  l   (berechnet, siehe Hinweis)
<applianceId>.consumption.lastWaterConsumption   l
<applianceId>.consumption.lastMaxFlowRate        l/min
```

> **`totalWaterConsumption`:** Die Grohe-Dashboard-API liefert den Gesamtverbrauch nicht zuverlässig. Der Adapter berechnet ihn aus `/data/aggregated`: Einmal täglich wird der historische Gesamtwert (ab Installationsdatum, nach Jahr gruppiert) abgerufen; jeden 5. Poll wird der aktuelle Tagesverbrauch addiert.

### Druckmessungs-Kanal

Wird jeden 10. Poll aktualisiert. Kann anfangs fehlen, wenn die API noch keine Daten liefert.

```
<applianceId>.pressureMeasurement.dropOfPressure   bar
<applianceId>.pressureMeasurement.isLeakage        boolean
<applianceId>.pressureMeasurement.leakageLevel     string
<applianceId>.pressureMeasurement.startTime        Datumsstring
```

> Der Leitungscheck läuft automatisch (typischerweise nachts). Der Button „Druckmessung starten" kann ihn manuell auslösen, aber das **Ventil muss geschlossen** und kein Wasser darf fließen, damit das Gerät den Befehl ausführt. Die Benachrichtigung `20_333` (Leitungscheck abgeschlossen) erscheint, wenn der Test beendet ist.

### Steuerungen

Steuerungen sind im **Steuerungs-Tab** der Device-Manager-Detailansicht und als beschreibbare ioBroker-States verfügbar.

**Ventil:**

```
<applianceId>.controls.valveOpen       boolean button – öffnet das Ventil
<applianceId>.controls.valveClose      boolean button – schließt das Ventil
```

**Druckmessung:**

```
<applianceId>.controls.startPressureMeasurement   boolean button
```

> Ventil muss vor dem Auslösen geschlossen sein. Das Gerät führt den Check aus, wenn die Bedingungen erfüllt sind.

**Snooze** – Alarme vorübergehend deaktivieren:

```
<applianceId>.controls.snooze.active     boolean (nur lesen) – Snooze aktuell aktiv
<applianceId>.controls.snooze.duration   number  1–240 min
<applianceId>.controls.snooze.start      boolean button – aktiviert Snooze für die eingestellte Dauer
<applianceId>.controls.snooze.stop       boolean button – deaktiviert Snooze sofort
```

Der `active`-State wird jeden 3. Poll aus der Grohe-API gelesen und nach Starten/Stoppen sofort aktualisiert.

**Wasserlimits:**

```
<applianceId>.controls.withdrawalAmountLimit   number  0–2000 l
```

Das Setzen dieses Wertes schreibt sofort in die Grohe-API. Der Wert wird jeden 10. Poll aus der API neu gelesen.

**Bewässerungsmodus** – Bewässerungsplan / Sprinklerprogramm:

```
<applianceId>.controls.sprinkler.startHour      number  0–23 Std
<applianceId>.controls.sprinkler.startMinute    number  0–59 min
<applianceId>.controls.sprinkler.stopHour       number  0–23 Std
<applianceId>.controls.sprinkler.stopMinute     number  0–59 min

<applianceId>.controls.sprinkler.activeMonday     boolean Schalter
<applianceId>.controls.sprinkler.activeTuesday    boolean Schalter
<applianceId>.controls.sprinkler.activeWednesday  boolean Schalter
<applianceId>.controls.sprinkler.activeThursday   boolean Schalter
<applianceId>.controls.sprinkler.activeFriday     boolean Schalter
<applianceId>.controls.sprinkler.activeSaturday   boolean Schalter
<applianceId>.controls.sprinkler.activeSunday     boolean Schalter

<applianceId>.controls.sprinkler.save   boolean button – sendet alle Bewässerungswerte an die API
```

> Start- und Stoppzeiten werden als separate Stunden- (0–23) und Minuten-States (0–59) gespeichert. Der Adapter kombiniert sie intern zu Minuten ab Mitternacht für die API. Änderungen an einzelnen Feldern werden lokal bestätigt, aber **nicht** an die API gesendet, bis **Speichern** gedrückt wird.

Die Bewässerungseinstellungen werden jeden 10. Poll aus der Grohe-API neu gelesen.

---

## Grohe Blue Home / Professional (Typ 104 / 105)

### Messwerte

```
<applianceId>.remainingCo2              %
<applianceId>.remainingFilter           %
<applianceId>.remainingCo2Liters        l
<applianceId>.remainingFilterLiters     l

<applianceId>.cyclesCarbonated
<applianceId>.cyclesStill

<applianceId>.operatingTime             min
<applianceId>.pumpRunningTime           min
<applianceId>.maxIdleTime               min
<applianceId>.timeSinceRestart          min

<applianceId>.waterRunningCarbonated    min
<applianceId>.waterRunningMedium        min
<applianceId>.waterRunningStill         min

<applianceId>.dateCleaning              Datumsstring
<applianceId>.dateCo2Replacement        Datumsstring
<applianceId>.dateFilterReplacement     Datumsstring
<applianceId>.lastMeasurement           Datumsstring

<applianceId>.cleaningCount
<applianceId>.filterChangeCount
<applianceId>.powerCutCount
<applianceId>.pumpCount
```

> **Messdaten-Aktualität:** Grohe-Blue-Geräte senden Messdaten **nicht** automatisch. Der Adapter sendet jeden 3. Poll-Zyklus einen `get_current_measurement`-Befehl. Danach prüft eine Hintergrund-Verifizierung alle 10 s (bis zu 3 Versuche / max. 30 s), ob neue Daten angekommen sind. Nach dem Adapterstart kann es 1–2 Poll-Zyklen dauern, bis aktuelle Werte angezeigt werden.

### Steuerungen

```
<applianceId>.controls.tapType          number  1 = still · 2 = medium · 3 = sprudel
<applianceId>.controls.tapAmount        number  ml, 50–2000 in Schritten von 50
<applianceId>.controls.dispenseTrigger  boolean button

<applianceId>.controls.resetCo2         boolean button
<applianceId>.controls.resetFilter      boolean button
```

Wenn `dispenseTrigger` auf `true` gesetzt wird, liest der Adapter `tapType` und `tapAmount`, führt den Zapfvorgang aus und setzt anschließend alle drei States auf `false` / `0` zurück.

---

## Polling-Strategie

Um API-Aufrufe zu minimieren und Rate-Limiting (HTTP 403) zu vermeiden, werden verschiedene Endpunkte in unterschiedlichen Intervallen abgefragt:

| Endpunkt | Häufigkeit | Geräte | Hinweise |
|---|---|---|---|
| `/dashboard` | jeder Poll | Alle | Kern-Sensordaten |
| `/status` | jeder 5. Poll | Alle | Online- / WLAN- / Update-Status ändert sich selten |
| `/command` (lesen) | jeder 3. Poll | Sense Guard | Ventilzustand; wird nach Befehlen sofort zurückgelesen |
| `/snooze` (lesen) | jeder 3. Poll | Sense Guard | Snooze-Status; HTTP 404 = kein aktiver Snooze |
| `/command` (`get_current_measurement`) | jeder 3. Poll | Blue | Löst frische Messung am Gerät aus |
| `/details` (Verifizierung) | bis zu 3× nach Refresh | Blue | Hintergrund-Abfrage ob neue Daten ankamen (10-s-Intervall, max. 30 s) |
| `/details` (Konfiguration) | jeder 10. Poll | Sense Guard | Bewässerungsplan, Entnahmelimit; immer beim ersten Poll |
| `/data/aggregated` (heute) | jeder 5. Poll | Sense Guard | Tagesverbrauch für `totalWaterConsumption` |
| `/data/aggregated` (historisch) | einmal pro Tag | Sense Guard | Historische Basis für `totalWaterConsumption` |
| `/pressuremeasurement` | jeder 10. Poll | Sense Guard | Ändert sich nur nach einem Leitungscheck |

> **Tipp:** Bei anhaltenden HTTP-403-Fehlern das Polling-Intervall erhöhen. Die Grohe-Cloud-API hat Rate-Limits.

### Exponentieller Backoff

Bei Polling-Fehlern erhöht der Adapter das Intervall automatisch:

1. Jeder aufeinanderfolgende Fehler **verdoppelt** das Intervall (300 → 600 → 1200 → 2400 → 3600 s).
2. Maximum: **1 Stunde**.
3. Nach Erreichen von 1 Stunde: Pause bis **12:00** Uhr (Mittag) bzw. bis **00:00** Uhr (Mitternacht), falls bereits nach 12:00 Uhr.
4. Nach einem **erfolgreichen** Poll wird das Intervall auf den konfigurierten Wert zurückgesetzt.

---

## Authentifizierung

Beim Start:

1. Das gespeicherte Refresh-Token wird aus `auth.refreshToken` gelesen.
2. Falls vorhanden, werden die Tokens automatisch erneuert.
3. Schlägt das Refresh fehl oder existiert kein Token, erfolgt ein kompletter Login mit E-Mail / Passwort.
4. Das neue Refresh-Token wird **verschlüsselt** (`enc:<...>`) in `auth.refreshToken` gespeichert.

Unverschlüsselte Tokens aus älteren Versionen werden automatisch in verschlüsselte Speicherung migriert.

Bei **HTTP 401** wird die Anfrage nach einem Token-Refresh einmalig wiederholt.

---

## Fallback-Erkennung

Gibt `/dashboard` HTTP 404 zurück (manche älteren Accounts), wechselt der Adapter in die Fallback-Erkennung:

1. User-ID wird aus dem JWT-Access-Token extrahiert.
2. `/users/{userId}` wird aufgerufen, um Standorte zu ermitteln.
3. Pro Gerät werden `/rooms` → `/appliances` + `/details` + `/notifications` abgerufen.

Der Fallback-Modus wird einmalig beim Start erkannt und für die gesamte Laufzeit der Instanz beibehalten.

---

## Fehlerbehandlung

| Situation | Verhalten |
|---|---|
| Polling-Fehler | `info.connection` → `false`; exponentieller Backoff |
| HTTP 401 | Token-Refresh, Anfrage einmalig wiederholt |
| HTTP 403 | Warnung geloggt; Hinweis, Grohe-Konto / App zu prüfen |
| HTTP 404 bei `/pressuremeasurement` | Nur Debug-Log (kein Messwert bisher ist normal) |
| HTTP 404 bei `/dashboard` | Wechsel in Fallback-Erkennung |

---

## Modul-Übersicht

| Datei | Funktion |
|---|---|
| `main.js` | Adapter-Kern: Polling, State-Verwaltung, Befehlsverarbeitung, Device-Manager-Messages |
| `lib/device-manager.js` | Device-Manager-Integration: Kacheln, Info-/Steuerungs-Tabs, Templates je Gerätetyp |
| `lib/groheClient.js` | Grohe-API-Client: authentifizierte Requests, Auto-Refresh bei 401 |
| `lib/auth.js` | OAuth / Keycloak-Login und Token-Refresh |
| `lib/notificationManager.js` | Versendet Push-Benachrichtigungen an konfigurierte Anbieter |
| `lib/notificationMessages.js` | Lokalisierte Benachrichtigungsvorlagen und Grohe-Benachrichtigungstyp-Texte (11 Sprachen) |
| `lib/apiDump.js` | Vollständiger API-Struktur-Dump für Diagnose (ausgelöst durch Raw-States-Option) |

// Web component <iob-grohe-device-card>: one Grohe appliance (Sense, Sense Guard,
// Blue Home / Professional) as a card in the look of the Device Manager card:
// header with icon, name and status icons, the values of the tile and, for
// appliances with controls, a second tab with the controls of the details view.
// Bundled by tasks/build-webcomponents.mjs into admin/webcomponents/device-card.js;
// its manifest is next to it.
//
// Writes go through the same controls.* states as the Device Manager, so the
// adapter handles them in onStateChange like every other UI.

import { IobWebComponent, defineWebComponent, getThemeCssVariables } from '@iobroker/web-components/element';
import { svg } from './icons.js';

/** @typedef {import('./icons.js').IconName} IconName */
/** @typedef {import('@iobroker/web-components').WebComponentSetting} Setting */

const ADAPTER = 'grohe-smarthome';
const TAG = 'iob-grohe-device-card';
/** How long a button shows that its command is being sent */
const BUSY_MS = 2500;
const TAP_STEP = 50;
const TAP_MIN = 50;
const TAP_MAX = 2000;
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const T = {
	info: { en: 'Info', de: 'Info' },
	controls: { en: 'Controls', de: 'Steuerung' },
	online: { en: 'Online', de: 'Online' },
	offline: { en: 'Offline', de: 'Offline' },
	sense: { en: 'Grohe Sense', de: 'Grohe Sense' },
	guard: { en: 'Grohe Sense Guard', de: 'Grohe Sense Guard' },
	blueHome: { en: 'Grohe Blue Home', de: 'Grohe Blue Home' },
	bluePro: { en: 'Grohe Blue Professional', de: 'Grohe Blue Professional' },
	device: { en: 'Grohe device', de: 'Grohe Gerät' },
	temperature: { en: 'Temperature', de: 'Temperatur' },
	waterTemperature: { en: 'Water temperature', de: 'Wassertemperatur' },
	humidity: { en: 'Humidity', de: 'Luftfeuchte' },
	battery: { en: 'Battery', de: 'Batterie' },
	flowRate: { en: 'Flow rate', de: 'Durchfluss' },
	pressure: { en: 'Pressure', de: 'Druck' },
	daily: { en: 'Daily consumption', de: 'Tagesverbrauch' },
	total: { en: 'Total consumption', de: 'Gesamtverbrauch' },
	pressureDrop: { en: 'Pressure drop', de: 'Druckabfall' },
	co2: { en: 'CO₂ remaining', de: 'CO₂ verbleibend' },
	filter: { en: 'Filter remaining', de: 'Filter verbleibend' },
	co2Liters: { en: 'CO₂ (liters)', de: 'CO₂ (Liter)' },
	filterLiters: { en: 'Filter (liters)', de: 'Filter (Liter)' },
	lastMeasurement: { en: 'Last measurement', de: 'Letzte Messung' },
	notification: { en: 'Latest notification', de: 'Letzte Meldung' },
	wifi: { en: 'WiFi quality', de: 'WLAN-Qualität' },
	updateAvailable: { en: 'Update available', de: 'Update verfügbar' },
	valve: { en: 'Valve', de: 'Ventil' },
	valveOpen: { en: 'Open', de: 'Offen' },
	valveClosed: { en: 'Closed', de: 'Geschlossen' },
	open: { en: 'Open', de: 'Öffnen' },
	close: { en: 'Close', de: 'Schließen' },
	pressureMeasurement: { en: 'Pressure measurement', de: 'Druckmessung' },
	start: { en: 'Start', de: 'Starten' },
	stop: { en: 'Stop', de: 'Beenden' },
	needsClosedValve: { en: 'The valve must be closed', de: 'Das Ventil muss geschlossen sein' },
	snooze: { en: 'Snooze', de: 'Snooze' },
	active: { en: 'Active', de: 'Aktiv' },
	inactive: { en: 'Inactive', de: 'Inaktiv' },
	duration: { en: 'Duration (min)', de: 'Dauer (min)' },
	limit: { en: 'Withdrawal amount limit', de: 'Entnahmelimit' },
	limitLabel: { en: 'Withdrawal amount limit (l)', de: 'Entnahmelimit (l)' },
	change: { en: 'Change', de: 'Ändern' },
	sprinkler: { en: 'Sprinkler mode', de: 'Bewässerungsmodus' },
	edit: { en: 'Edit', de: 'Bearbeiten' },
	unsaved: { en: 'Unsaved changes', de: 'Ungespeicherte Änderungen' },
	noDays: { en: 'no days', de: 'keine Tage' },
	startHour: { en: 'Start time – h', de: 'Startzeit – Std' },
	startMinute: { en: 'Start time – min', de: 'Startzeit – min' },
	stopHour: { en: 'Stop time – h', de: 'Stoppzeit – Std' },
	stopMinute: { en: 'Stop time – min', de: 'Stoppzeit – min' },
	Monday: { en: 'Monday', de: 'Montag' },
	Tuesday: { en: 'Tuesday', de: 'Dienstag' },
	Wednesday: { en: 'Wednesday', de: 'Mittwoch' },
	Thursday: { en: 'Thursday', de: 'Donnerstag' },
	Friday: { en: 'Friday', de: 'Freitag' },
	Saturday: { en: 'Saturday', de: 'Samstag' },
	Sunday: { en: 'Sunday', de: 'Sonntag' },
	dispense: { en: 'Dispense', de: 'Zapfen' },
	tapType: { en: 'Tap type', de: 'Zapfart' },
	amount: { en: 'Amount', de: 'Menge' },
	still: { en: 'Still', de: 'Still' },
	medium: { en: 'Medium', de: 'Medium' },
	carbonated: { en: 'Carbonated', de: 'Sprudel' },
	less: { en: 'Less', de: 'Weniger' },
	more: { en: 'More', de: 'Mehr' },
	service: { en: 'Service', de: 'Service' },
	resetCo2: { en: 'Reset CO₂', de: 'CO₂ zurücksetzen' },
	resetFilter: { en: 'Reset filter', de: 'Filter zurücksetzen' },
	confirmResetCo2: {
		en: 'Reset the CO₂ counter? Only do this after replacing the CO₂ bottle.',
		de: 'CO₂-Zähler zurücksetzen? Nur nach dem Tausch der CO₂-Flasche ausführen.',
	},
	confirmResetFilter: {
		en: 'Reset the filter counter? Only do this after replacing the filter.',
		de: 'Filterzähler zurücksetzen? Nur nach dem Filterwechsel ausführen.',
	},
	moreInfo: { en: 'Appliance information', de: 'Geräteinformationen' },
	general: { en: 'General', de: 'Allgemein' },
	applianceId: { en: 'Appliance ID', de: 'Geräte-ID' },
	type: { en: 'Type', de: 'Typ' },
	yes: { en: 'Yes', de: 'Ja' },
	no: { en: 'No', de: 'Nein' },
	category: { en: 'Category', de: 'Kategorie' },
	message: { en: 'Message', de: 'Meldung' },
	time: { en: 'Time', de: 'Zeitpunkt' },
	consumption: { en: 'Consumption', de: 'Verbrauch' },
	averageDaily: { en: 'Average per day', de: 'Ø pro Tag' },
	averageMonthly: { en: 'Average per month', de: 'Ø pro Monat' },
	lastWithdrawal: { en: 'Last withdrawal', de: 'Letzte Entnahme' },
	lastMaxFlowRate: { en: 'Max. flow rate of the last withdrawal', de: 'Max. Durchfluss der letzten Entnahme' },
	leakage: { en: 'Leakage detected', de: 'Leckage erkannt' },
	leakageLevel: { en: 'Leakage level', de: 'Leckage-Stufe' },
	snoozeDuration: { en: 'Snooze duration', de: 'Snooze-Dauer' },
	maintenance: { en: 'Maintenance', de: 'Wartung' },
	filterApp: { en: 'Filter remaining (app)', de: 'Filter verbleibend (App)' },
	dateCleaning: { en: 'Last cleaning', de: 'Letzte Reinigung' },
	dateCo2: { en: 'Last CO₂ replacement', de: 'Letzter CO₂-Tausch' },
	dateFilter: { en: 'Last filter replacement', de: 'Letzter Filterwechsel' },
	cleaningCount: { en: 'Cleanings', de: 'Reinigungen' },
	filterChangeCount: { en: 'Filter changes', de: 'Filterwechsel' },
	operation: { en: 'Operation', de: 'Betrieb' },
	operatingTime: { en: 'Operating time', de: 'Betriebszeit' },
	pumpRunningTime: { en: 'Pump running time', de: 'Pumpenlaufzeit' },
	pumpCount: { en: 'Pump cycles', de: 'Pumpenzyklen' },
	cyclesStill: { en: 'Tap cycles still', de: 'Zapfzyklen still' },
	cyclesCarbonated: { en: 'Tap cycles carbonated', de: 'Zapfzyklen Sprudel' },
	runningStill: { en: 'Water running still', de: 'Wasserlaufzeit still' },
	runningMedium: { en: 'Water running medium', de: 'Wasserlaufzeit medium' },
	runningCarbonated: { en: 'Water running carbonated', de: 'Wasserlaufzeit Sprudel' },
	maxIdleTime: { en: 'Max. idle time', de: 'Max. Standzeit' },
	timeSinceRestart: { en: 'Time since restart', de: 'Zeit seit Neustart' },
	powerCutCount: { en: 'Power cuts', de: 'Stromausfälle' },
	noInfo: { en: 'No further information yet', de: 'Noch keine weiteren Informationen' },
	noDevice: { en: 'No Grohe appliance found', de: 'Kein Grohe-Gerät gefunden' },
	readOnly: { en: 'Appliance offline – controls disabled', de: 'Gerät offline – Steuerung gesperrt' },
};

/** Type of the appliance (native.type of the device) → label and icon file in admin/ */
const TYPES = {
	SENSE: { label: T.sense, icon: 'grohe-sense.png' },
	SENSE_GUARD: { label: T.guard, icon: 'grohe-sense-guard.png' },
	BLUE_HOME: { label: T.blueHome, icon: 'grohe-blue.png' },
	BLUE_PROFESSIONAL: { label: T.bluePro, icon: 'grohe-blue.png' },
};

/** States of every appliance, relative to the device */
const COMMON_STATES = [
	'status.online',
	'status.wifiQuality',
	'status.updateAvailable',
	'lastMeasurement',
	'notifications.latestMessage',
	'notifications.latestTimestamp',
];

const SPRINKLER_TIMES = ['startHour', 'startMinute', 'stopHour', 'stopMinute'];

/**
 * Sections of the info dialog: what the card itself does not show. The states are read once when the
 * dialog opens, so the card does not subscribe dozens of rarely needed states.
 * `kind`: how the value is shown; `types`: only for these appliance types
 *
 * @type {{title: {en: string, de: string}, types?: string[], rows: {state: string, label: {en: string, de: string}, kind: 'num' | 'bool' | 'date' | 'minutes' | 'text', unit?: string, decimals?: number}[]}[]}
 */
const INFO_SECTIONS = [
	{
		title: T.general,
		rows: [
			{ state: 'status.online', label: T.online, kind: 'bool' },
			{ state: 'status.wifiQuality', label: T.wifi, kind: 'num', decimals: 0 },
			{ state: 'status.updateAvailable', label: T.updateAvailable, kind: 'bool' },
			{ state: 'lastMeasurement', label: T.lastMeasurement, kind: 'date' },
		],
	},
	{
		title: T.notification,
		rows: [
			{ state: 'notifications.latestMessage', label: T.message, kind: 'text' },
			{ state: 'notifications.latestCategoryName', label: T.category, kind: 'text' },
			{ state: 'notifications.latestTimestamp', label: T.time, kind: 'date' },
		],
	},
	{
		title: T.consumption,
		types: ['SENSE_GUARD'],
		rows: [
			{ state: 'consumption.averageDaily', label: T.averageDaily, kind: 'num', unit: 'l', decimals: 0 },
			{ state: 'consumption.averageMonthly', label: T.averageMonthly, kind: 'num', unit: 'l', decimals: 0 },
			{ state: 'consumption.lastWaterConsumption', label: T.lastWithdrawal, kind: 'num', unit: 'l', decimals: 1 },
			{ state: 'consumption.lastMaxFlowRate', label: T.lastMaxFlowRate, kind: 'num', unit: 'l/min', decimals: 1 },
		],
	},
	{
		title: T.pressureMeasurement,
		types: ['SENSE_GUARD'],
		rows: [
			{ state: 'pressureMeasurement.startTime', label: T.time, kind: 'date' },
			{
				state: 'pressureMeasurement.dropOfPressure',
				label: T.pressureDrop,
				kind: 'num',
				unit: 'bar',
				decimals: 2,
			},
			{ state: 'pressureMeasurement.isLeakage', label: T.leakage, kind: 'bool' },
			{ state: 'pressureMeasurement.leakageLevel', label: T.leakageLevel, kind: 'text' },
		],
	},
	{
		title: T.snooze,
		types: ['SENSE_GUARD'],
		rows: [{ state: 'controls.snooze.duration', label: T.snoozeDuration, kind: 'num', unit: 'min', decimals: 0 }],
	},
	{
		title: T.maintenance,
		types: ['BLUE_HOME', 'BLUE_PROFESSIONAL'],
		rows: [
			{ state: 'remainingFilterApp', label: T.filterApp, kind: 'num', unit: '%', decimals: 0 },
			{ state: 'dateCleaning', label: T.dateCleaning, kind: 'date' },
			{ state: 'dateCo2Replacement', label: T.dateCo2, kind: 'date' },
			{ state: 'dateFilterReplacement', label: T.dateFilter, kind: 'date' },
			{ state: 'cleaningCount', label: T.cleaningCount, kind: 'num', decimals: 0 },
			{ state: 'filterChangeCount', label: T.filterChangeCount, kind: 'num', decimals: 0 },
		],
	},
	{
		title: T.operation,
		types: ['BLUE_HOME', 'BLUE_PROFESSIONAL'],
		rows: [
			{ state: 'operatingTime', label: T.operatingTime, kind: 'minutes' },
			{ state: 'pumpRunningTime', label: T.pumpRunningTime, kind: 'minutes' },
			{ state: 'pumpCount', label: T.pumpCount, kind: 'num', decimals: 0 },
			{ state: 'cyclesStill', label: T.cyclesStill, kind: 'num', decimals: 0 },
			{ state: 'cyclesCarbonated', label: T.cyclesCarbonated, kind: 'num', decimals: 0 },
			{ state: 'waterRunningStill', label: T.runningStill, kind: 'minutes' },
			{ state: 'waterRunningMedium', label: T.runningMedium, kind: 'minutes' },
			{ state: 'waterRunningCarbonated', label: T.runningCarbonated, kind: 'minutes' },
			{ state: 'maxIdleTime', label: T.maxIdleTime, kind: 'minutes' },
			{ state: 'timeSinceRestart', label: T.timeSinceRestart, kind: 'minutes' },
			{ state: 'powerCutCount', label: T.powerCutCount, kind: 'num', decimals: 0 },
		],
	},
];

/** Styles of the info dialog: its element is moved into the dialog of the host, outside the card */
const INFO_STYLE = `
:host { display: block; color: var(--iob-text); font-family: var(--iob-font-family); font-size: var(--iob-font-size); }
h3 { margin: 14px 0 4px; font-size: .8em; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: var(--iob-primary); }
h3:first-child { margin-top: 0; }
table { width: 100%; border-collapse: collapse; }
td { padding: 5px 0; border-bottom: 1px solid var(--iob-divider); vertical-align: top; }
td:first-child { color: var(--iob-text-secondary); padding-right: 16px; }
td:last-child { text-align: right; word-break: break-word; }
.empty { color: var(--iob-text-secondary); }
`;

/** States per type, relative to the device */
const TYPE_STATES = {
	SENSE: ['temperature', 'humidity', 'battery'],
	SENSE_GUARD: [
		'temperature',
		'flowRate',
		'pressure',
		'valveOpen',
		'consumption.daily',
		'consumption.totalWaterConsumption',
		'pressureMeasurement.dropOfPressure',
		'controls.snooze.active',
		'controls.snooze.duration',
		'controls.withdrawalAmountLimit',
		'controls.sprinkler.pending',
		...SPRINKLER_TIMES.map(s => `controls.sprinkler.${s}`),
		...DAYS.map(d => `controls.sprinkler.active${d}`),
	],
	BLUE_HOME: [
		'remainingCo2',
		'remainingFilter',
		'remainingCo2Liters',
		'remainingFilterLiters',
		'controls.tapType',
		'controls.tapAmount',
	],
};
TYPE_STATES.BLUE_PROFESSIONAL = TYPE_STATES.BLUE_HOME;

/**
 * Values on the Info tab: state, label, unit, decimals, icon; `bar` draws a fill level
 *
 * @type {Record<string, {state: string, label: {en: string, de: string}, unit: string, decimals: number, icon: IconName, bar?: boolean, optional?: boolean}[]>}
 */
const VALUES = {
	SENSE: [
		{ state: 'temperature', label: T.temperature, unit: '°C', decimals: 1, icon: 'thermometer' },
		{ state: 'humidity', label: T.humidity, unit: '%', decimals: 0, icon: 'drop' },
		{ state: 'battery', label: T.battery, unit: '%', decimals: 0, icon: 'battery', bar: true },
	],
	SENSE_GUARD: [
		{ state: 'temperature', label: T.waterTemperature, unit: '°C', decimals: 1, icon: 'thermometer' },
		{ state: 'flowRate', label: T.flowRate, unit: 'l/min', decimals: 1, icon: 'flow' },
		{ state: 'pressure', label: T.pressure, unit: 'bar', decimals: 1, icon: 'gauge' },
		{ state: 'consumption.daily', label: T.daily, unit: 'l', decimals: 0, icon: 'chart' },
		{ state: 'consumption.totalWaterConsumption', label: T.total, unit: 'l', decimals: 0, icon: 'drop' },
		{
			state: 'pressureMeasurement.dropOfPressure',
			label: T.pressureDrop,
			unit: 'bar',
			decimals: 2,
			icon: 'gauge',
			optional: true,
		},
	],
	BLUE_HOME: [
		{ state: 'remainingCo2', label: T.co2, unit: '%', decimals: 0, icon: 'bubbles', bar: true },
		{ state: 'remainingFilter', label: T.filter, unit: '%', decimals: 0, icon: 'filter', bar: true },
		{ state: 'remainingCo2Liters', label: T.co2Liters, unit: 'l', decimals: 0, icon: 'bubbles' },
		{ state: 'remainingFilterLiters', label: T.filterLiters, unit: 'l', decimals: 0, icon: 'filter' },
	],
};
VALUES.BLUE_PROFESSIONAL = VALUES.BLUE_HOME;

const TAP_TYPES = [
	{ value: 1, text: T.still },
	{ value: 2, text: T.medium },
	{ value: 3, text: T.carbonated },
];

/** Shown in the editor of a host while no appliance is chosen */
const SAMPLE_TYPE = 'SENSE_GUARD';
const SAMPLE = {
	'status.online': true,
	'status.wifiQuality': 78,
	'status.updateAvailable': false,
	temperature: 14.2,
	flowRate: 0,
	pressure: 3.9,
	valveOpen: true,
	'consumption.daily': 186,
	'consumption.totalWaterConsumption': 254310,
	'controls.snooze.active': false,
	'controls.snooze.duration': 30,
	'controls.withdrawalAmountLimit': 300,
	'controls.sprinkler.startHour': 6,
	'controls.sprinkler.startMinute': 0,
	'controls.sprinkler.stopHour': 7,
	'controls.sprinkler.stopMinute': 30,
	'controls.sprinkler.activeMonday': true,
	'controls.sprinkler.activeWednesday': true,
	'controls.sprinkler.activeFriday': true,
};

const STYLE = `
:host { display: block; width: 100%; height: 100%; }
* { box-sizing: border-box; }
.card {
	container-type: size;
	width: 100%; height: 100%;
	display: flex; flex-direction: column;
	overflow: hidden;
	background: var(--iob-paper);
	color: var(--iob-text);
	font-family: var(--iob-font-family);
	font-size: var(--iob-font-size);
	border: 1px solid var(--iob-divider);
	border-radius: calc(var(--iob-border-radius) * 2);
}
.header {
	display: flex; align-items: center; gap: 12px;
	padding: 10px 12px;
	background: var(--iob-primary); color: var(--iob-primary-contrast);
}
.header.offline { background: #f44336; color: #fff; }
.header img { width: 44px; height: 44px; border-radius: 50%; object-fit: contain; background: #fff; padding: 3px; flex: none; }
.title { flex: 1; min-width: 0; }
.name { font-size: 1.15em; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sub { font-size: .85em; opacity: .85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.status { display: flex; align-items: center; gap: 6px; flex: none; }
.info-btn {
	width: 28px; height: 28px; padding: 3px; flex: none; border: 0; border-radius: 50%;
	background: transparent; color: inherit; cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
}
.info-btn:hover { background: rgba(255,255,255,.2); }
.info-btn svg { width: 22px; height: 22px; }
.status .ico { display: inline-flex; align-items: center; gap: 2px; font-size: .8em; padding: 2px 4px; border-radius: 10px; background: rgba(255,255,255,.92); color: #333; }
.status svg { width: 16px; height: 16px; }
.tabs { display: flex; border-bottom: 1px solid var(--iob-divider); }
.tab {
	flex: 1; padding: 8px 4px; background: transparent; border: 0; border-bottom: 2px solid transparent;
	color: var(--iob-text-secondary); font-family: inherit; font-size: .85em; font-weight: 600;
	text-transform: uppercase; letter-spacing: .04em; cursor: pointer;
}
.tab.selected { color: var(--iob-primary); border-bottom-color: var(--iob-primary); }
.body { flex: 1; min-height: 0; overflow: auto; padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 10px; }
.values { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; }
.value { border: 1px solid var(--iob-divider); border-radius: var(--iob-border-radius); padding: 8px 10px; }
.value .label { display: flex; align-items: center; gap: 4px; }
.value .label svg { width: 16px; height: 16px; flex: none; }
.value .label svg path { fill: var(--iob-primary); }
.big { font-size: 1.6em; font-weight: 300; line-height: 1.2; white-space: nowrap; }
.big small { font-size: .55em; color: var(--iob-text-secondary); margin-left: 3px; }
.bar { height: 4px; border-radius: 2px; background: var(--iob-divider); overflow: hidden; margin-top: 4px; }
.bar > div { height: 100%; background: #4caf50; }
.bar.low > div { background: #ff9800; }
.bar.empty > div { background: #f44336; }
.label { font-size: .78em; color: var(--iob-text-secondary); text-transform: uppercase; letter-spacing: .04em; }
.meta { font-size: .85em; color: var(--iob-text-secondary); display: flex; flex-direction: column; gap: 4px; }
.meta .row { display: flex; align-items: flex-start; gap: 6px; }
.meta svg { width: 16px; height: 16px; flex: none; margin-top: 1px; }
.meta svg path { fill: var(--iob-text-secondary); }
.section { display: flex; flex-direction: column; gap: 6px; padding-bottom: 10px; border-bottom: 1px solid var(--iob-divider); }
.section:last-child { border-bottom: 0; padding-bottom: 0; }
.section-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.section-head .label { display: flex; align-items: center; gap: 6px; font-weight: 600; }
.section-head .label svg { width: 18px; height: 18px; }
.section-head .label svg path { fill: var(--iob-primary); }
.chip { font-size: .8em; padding: 2px 8px; border-radius: 10px; background: var(--iob-divider); white-space: nowrap; }
.chip.ok { background: #4caf50; color: #fff; }
.chip.warn { background: #ff9800; color: #fff; }
.chip.err { background: #f44336; color: #fff; }
.row-buttons { display: flex; gap: 6px; flex-wrap: wrap; }
.row-buttons > * { flex: 1; }
.btn {
	display: inline-flex; align-items: center; justify-content: center; gap: 6px;
	padding: 6px 10px; min-height: 34px;
	border: 1px solid var(--iob-primary); border-radius: var(--iob-border-radius);
	background: transparent; color: var(--iob-primary);
	font-family: inherit; font-size: .85em; font-weight: 600; text-transform: uppercase; letter-spacing: .03em;
	cursor: pointer; white-space: nowrap;
}
.btn svg { width: 18px; height: 18px; flex: none; }
.btn.primary, .btn.selected { background: var(--iob-primary); color: var(--iob-primary-contrast); }
.btn.busy { animation: pulse 1s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: .5; } }
button:disabled { cursor: default; opacity: .45; }
.detail { font-size: .85em; color: var(--iob-text-secondary); }
.amount { display: flex; align-items: center; justify-content: center; gap: 12px; }
.amount .big { min-width: 96px; text-align: center; font-weight: 400; }
.round { width: 34px; height: 34px; padding: 0; border-radius: 50%; font-size: 1.3em; text-transform: none; }
.hint { font-size: .85em; color: var(--iob-warning); }
.empty { flex: 1; display: flex; align-items: center; justify-content: center; color: var(--iob-text-secondary); padding: 12px; text-align: center; }
.edit button { pointer-events: none; }
/* devices: a 2×2 tile is about 300 px wide and high */
@container (max-height: 380px) { .meta { display: none; } }
@container (max-width: 320px) {
	.header { padding: 6px 10px; gap: 8px; }
	.header img { width: 34px; height: 34px; }
	.name { font-size: 1em; }
	.sub { font-size: .75em; }
	.tab { padding: 5px 4px; font-size: .75em; }
	.body { padding: 8px; gap: 8px; }
	.values { grid-template-columns: 1fr 1fr; gap: 6px; }
	.value { padding: 4px 8px; }
	.value .label { font-size: .68em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; }
	.value .label svg { display: none; }
	.big { font-size: 1.25em; }
	.status .ico span { display: none; }
	.section { gap: 4px; padding-bottom: 8px; }
	.btn { min-height: 30px; padding: 4px 6px; font-size: .75em; }
	.btn svg { width: 16px; height: 16px; }
}
`;

/**
 * @param {unknown} value text
 * @returns {string} HTML-escaped text
 */
function esc(value) {
	return String(value ?? '').replace(
		/[&<>"']/g,
		c =>
			/** @type {Record<string, string>} */ ({
				'&': '&amp;',
				'<': '&lt;',
				'>': '&gt;',
				'"': '&quot;',
				"'": '&#39;',
			})[c],
	);
}

/**
 * @param {unknown} value number or anything
 * @returns {number | null} finite number or null
 */
function num(value) {
	const n = typeof value === 'number' ? value : value === null || value === '' ? NaN : Number(value);
	return Number.isFinite(n) ? n : null;
}

/**
 * @param {unknown} value number
 * @returns {string} two digits
 */
function pad(value) {
	return String(num(value) ?? 0).padStart(2, '0');
}

/**
 * @param {number} value amount in ml
 * @returns {number} amount the adapter accepts: 50–2000 ml in steps of 50
 */
function clampAmount(value) {
	return Math.min(TAP_MAX, Math.max(TAP_MIN, Math.round(value / TAP_STEP) * TAP_STEP));
}

/**
 * @param {ioBroker.Object | null | undefined} obj device object of an appliance
 * @returns {string} its type, `native.type` (SENSE, SENSE_GUARD, ...)
 */
function typeOf(obj) {
	return String(obj?.native?.type || '');
}

/** Card of one Grohe appliance, registered as <iob-grohe-device-card> */
class GroheDeviceCard extends IobWebComponent {
	/** @type {string} appliance found without a setting: the first of the instance */
	#autoBase = '';

	/** @type {string} instance the automatic search ran for */
	#searched = '';

	/** @type {'info' | 'controls'} */
	#tab = 'info';

	/** @type {string} appliance the local selections below belong to */
	#selectionBase = '';

	/** @type {number | null} Blue: tap type picked in the card, not sent yet */
	#tapType = null;

	/** @type {number | null} Blue: amount picked in the card, not sent yet */
	#tapAmount = null;

	/** @type {string} action being sent */
	#busy = '';

	/** @type {ReturnType<typeof setTimeout> | undefined} */
	#busyTimer;

	/** Shadow root with the styles; clicks are handled in one listener */
	constructor() {
		super();
		const root = this.attachShadow({ mode: 'open' });
		root.innerHTML = `<style>${STYLE}</style><div class="card"></div>`;
		root.addEventListener('click', e => this.#onClick(/** @type {Event} */ (e)));
	}

	/** Stops the busy timer when the host removes the card */
	disconnectedCallback() {
		super.disconnectedCallback();
		clearTimeout(this.#busyTimer);
		this.#busy = '';
	}

	/** @returns {string} instance of the settings, `grohe-smarthome.0` if none */
	get #instance() {
		const instance = String(this.settings.instance || '').replace(/^system\.adapter\./, '');
		return instance || `${ADAPTER}.0`;
	}

	/** @returns {string} full id of the appliance device, empty while unknown */
	get #base() {
		return String(this.settings.device || '') || this.#autoBase;
	}

	/** @returns {string} type of the appliance (native.type), the sample type in the editor */
	get #type() {
		const base = this.#base;
		if (!base) {
			return SAMPLE_TYPE;
		}
		return typeOf(this.objects[base]);
	}

	/**
	 * @param {Record<string, unknown>} settings settings of the host
	 * @returns {string[]} states of the appliance; those of its type once its object is known
	 */
	getStateIds(settings) {
		const base = String(settings.device || '') || this.#autoBase;
		if (!base) {
			return [];
		}
		const type = typeOf(this.objects?.[base]);
		const states = [...COMMON_STATES, ...(TYPE_STATES[/** @type {keyof TYPE_STATES} */ (type)] || [])];
		return states.map(s => `${base}.${s}`);
	}

	/**
	 * @param {Record<string, unknown>} settings settings of the host
	 * @returns {string[]} the device: its name and its type
	 */
	getObjectIds(settings) {
		const base = String(settings.device || '') || this.#autoBase;
		return base ? [base] : [];
	}

	/** Without a chosen appliance, take the first one of the instance */
	#findDevice() {
		const instance = this.#instance;
		if (!this.socket || this.settings.device || this.#searched === instance) {
			return;
		}
		this.#searched = instance;
		this.socket
			.getObjectViewSystem('device', `${instance}.`, `${instance}.\u9999`)
			.then(devices => {
				const ids = Object.keys(devices || {})
					.filter(id => !id.slice(instance.length + 1).includes('.'))
					.sort();
				if (ids[0] && this.#instance === instance) {
					this.#autoBase = ids[0];
					// the setter subscribes the states of the new appliance
					this.settings = { ...this.settings };
				}
			})
			.catch(() => {});
	}

	/**
	 * @param {string} state state id relative to the appliance
	 * @returns {unknown} its value; sample data in the editor
	 */
	#val(state) {
		const base = this.#base;
		if (!base) {
			return /** @type {Record<string, unknown>} */ (SAMPLE)[state];
		}
		return this.states[`${base}.${state}`]?.val;
	}

	/**
	 * @param {unknown} value number
	 * @param {number} decimals decimals to show
	 * @returns {string} formatted in the system language, `–` if unknown
	 */
	#num(value, decimals) {
		const n = num(value);
		if (n === null) {
			return '–';
		}
		return n.toLocaleString(this.systemLang, {
			minimumFractionDigits: decimals,
			maximumFractionDigits: decimals,
		});
	}

	/**
	 * @param {unknown} value ISO timestamp
	 * @returns {string} date and time in the system language
	 */
	#date(value) {
		if (!value) {
			return '–';
		}
		const date = new Date(String(value));
		if (Number.isNaN(date.getTime())) {
			return String(value);
		}
		return date.toLocaleString(this.systemLang, { dateStyle: 'short', timeStyle: 'short' });
	}

	/** @returns {boolean} the appliance takes commands: not in the editor, and online */
	#writable() {
		return !this.editMode && !!this.socket && !!this.#base && this.#val('status.online') !== false;
	}

	/** Draws the card: header, tabs and the shown tab */
	render() {
		const card = /** @type {HTMLElement} */ (this.shadowRoot?.querySelector('.card'));
		this.#findDevice();
		const base = this.#base;
		// no appliance and not in the editor: say so instead of showing made-up values
		if (!base && this.socket && !this.editMode) {
			card.className = 'card';
			card.innerHTML = `<div class="empty">${esc(this.text(T.noDevice))}</div>`;
			return;
		}
		if (base !== this.#selectionBase) {
			this.#selectionBase = base;
			this.#tapType = null;
			this.#tapAmount = null;
		}
		const type = this.#type;
		const typeInfo = TYPES[/** @type {keyof TYPES} */ (type)];
		const hasControls = type === 'SENSE_GUARD' || type === 'BLUE_HOME' || type === 'BLUE_PROFESSIONAL';
		const tab = hasControls ? this.#tab : 'info';
		const online = this.#val('status.online') !== false;
		const name = base ? this.text(this.objects[base]?.common?.name) || base : 'Sense Guard';
		const icon = new URL(`../${typeInfo?.icon || 'grohe-smarthome.png'}`, import.meta.url).href;

		card.className = `card${this.editMode ? ' edit' : ''}`;
		card.innerHTML = `
			<div class="header${online ? '' : ' offline'}">
				<img src="${esc(icon)}" alt="">
				<div class="title">
					<div class="name" title="${esc(name)}">${esc(name)}</div>
					<div class="sub">${esc(this.text(typeInfo?.label || T.device))}</div>
				</div>
				<div class="status">${this.#statusIcons(type, online)}</div>
				<button class="info-btn" data-info="1" title="${esc(this.text(T.moreInfo))}">${svg('info')}</button>
			</div>
			${
				hasControls
					? `<div class="tabs">
						<button class="tab${tab === 'info' ? ' selected' : ''}" data-tab="info">${esc(this.text(T.info))}</button>
						<button class="tab${tab === 'controls' ? ' selected' : ''}" data-tab="controls">${esc(this.text(T.controls))}</button>
					</div>`
					: ''
			}
			<div class="body">${tab === 'controls' ? this.#controls(type) : this.#info(type)}</div>`;
	}

	/**
	 * Status icons of the Device Manager card: connection, WiFi, battery, warning, update
	 *
	 * @param {string} type appliance type
	 * @param {boolean} online appliance online
	 * @returns {string} HTML
	 */
	#statusIcons(type, online) {
		const icons = [];
		const wifi = num(this.#val('status.wifiQuality'));
		icons.push(
			`<span class="ico" title="${esc(this.text(online ? T.online : T.offline))}${wifi !== null ? ` – ${esc(this.text(T.wifi))} ${wifi}` : ''}">${svg(online ? 'wifi' : 'wifiOff', online ? 'ok' : 'error')}${wifi !== null && online ? `<span>${wifi}</span>` : ''}</span>`,
		);
		if (type === 'SENSE') {
			const battery = num(this.#val('battery'));
			if (battery !== null) {
				const color = battery <= 10 ? 'error' : battery <= 25 ? 'warning' : 'ok';
				icons.push(
					`<span class="ico" title="${esc(this.text(T.battery))}">${svg('battery', color)}<span>${battery}%</span></span>`,
				);
			}
		}
		if (type === 'SENSE_GUARD' && this.#val('valveOpen') === false) {
			icons.push(
				`<span class="ico" title="${esc(this.text(T.valve))}: ${esc(this.text(T.valveClosed))}">${svg('warning', 'warning')}</span>`,
			);
		}
		if (this.#val('status.updateAvailable') === true) {
			icons.push(
				`<span class="ico" title="${esc(this.text(T.updateAvailable))}">${svg('update', 'info')}</span>`,
			);
		}
		return icons.join('');
	}

	/**
	 * Info tab: the values of the Device Manager tile and the latest measurement / notification
	 *
	 * @param {string} type appliance type
	 * @returns {string} HTML
	 */
	#info(type) {
		const values = (VALUES[type] || []).filter(v => !v.optional || num(this.#val(v.state)) !== null);
		const tiles = values.map(v => {
			const n = num(this.#val(v.state));
			const bar =
				v.bar && n !== null
					? `<div class="bar${n <= 10 ? ' empty' : n <= 25 ? ' low' : ''}"><div style="width:${Math.min(100, Math.max(0, n))}%"></div></div>`
					: '';
			return `<div class="value">
				<div class="label">${svg(v.icon)}${esc(this.text(v.label))}</div>
				<div class="big">${this.#num(n, v.decimals)}<small>${esc(v.unit)}</small></div>${bar}
			</div>`;
		});
		if (type === 'SENSE_GUARD') {
			const open = this.#val('valveOpen');
			tiles.unshift(`<div class="value">
				<div class="label">${svg(open === false ? 'block' : 'drop')}${esc(this.text(T.valve))}</div>
				<div class="big">${esc(open === undefined || open === null ? '–' : this.text(open ? T.valveOpen : T.valveClosed))}</div>
			</div>`);
		}
		const meta = [];
		if (this.#val('lastMeasurement')) {
			meta.push(
				`<div class="row">${svg('schedule')}<span>${esc(this.text(T.lastMeasurement))}: ${esc(this.#date(this.#val('lastMeasurement')))}</span></div>`,
			);
		}
		const message = this.#val('notifications.latestMessage');
		if (message) {
			meta.push(
				`<div class="row">${svg('bell')}<span>${esc(message)} (${esc(this.#date(this.#val('notifications.latestTimestamp')))})</span></div>`,
			);
		}
		return `<div class="values">${tiles.join('')}</div>${meta.length ? `<div class="meta">${meta.join('')}</div>` : ''}`;
	}

	/**
	 * Controls tab of the Sense Guard and the Blue
	 *
	 * @param {string} type appliance type
	 * @returns {string} HTML
	 */
	#controls(type) {
		const writable = this.#writable();
		const hint =
			!writable && this.#base && !this.editMode && this.socket
				? `<div class="hint">${esc(this.text(T.readOnly))}</div>`
				: '';
		return hint + (type === 'SENSE_GUARD' ? this.#guardControls(writable) : this.#blueControls(writable));
	}

	/**
	 * @param {string} action data-action of the button
	 * @param {IconName} icon icon name
	 * @param {{en: string, de: string}} text label
	 * @param {{disabled?: boolean, cls?: string, title?: string, attrs?: string}} [options] state of the button
	 * @returns {string} HTML of a button
	 */
	#button(action, icon, text, options = {}) {
		const cls = `btn${options.cls ? ` ${options.cls}` : ''}${this.#busy === action ? ' busy' : ''}`;
		const title = options.title || this.text(text);
		return `<button class="${cls}" data-action="${action}" title="${esc(title)}" ${options.attrs || ''} ${options.disabled ? 'disabled' : ''}>${icon ? svg(icon) : ''}<span>${esc(this.text(text))}</span></button>`;
	}

	/**
	 * @param {IconName} icon icon name
	 * @param {{en: string, de: string}} title section title
	 * @param {string} chip HTML right of the title
	 * @param {string} content HTML below
	 * @returns {string} HTML of a section
	 */
	#section(icon, title, chip, content) {
		return `<div class="section">
			<div class="section-head"><div class="label">${svg(icon)}${esc(this.text(title))}</div>${chip}</div>
			${content}
		</div>`;
	}

	/**
	 * @param {boolean} writable controls enabled
	 * @returns {string} HTML of the Sense Guard controls
	 */
	#guardControls(writable) {
		const open = this.#val('valveOpen');
		const valveChip =
			open === undefined || open === null
				? ''
				: `<span class="chip ${open ? 'ok' : 'warn'}">${esc(this.text(open ? T.valveOpen : T.valveClosed))}</span>`;
		const snoozeActive = this.#val('controls.snooze.active') === true;
		const limit = num(this.#val('controls.withdrawalAmountLimit'));
		const days = DAYS.filter(d => this.#val(`controls.sprinkler.active${d}`) === true);
		const dayNames = days.map(d =>
			new Date(Date.UTC(2024, 0, 1 + DAYS.indexOf(d))).toLocaleDateString(this.systemLang, {
				weekday: 'short',
				timeZone: 'UTC',
			}),
		);
		const sprinkler = `${pad(this.#val('controls.sprinkler.startHour'))}:${pad(this.#val('controls.sprinkler.startMinute'))} – ${pad(this.#val('controls.sprinkler.stopHour'))}:${pad(this.#val('controls.sprinkler.stopMinute'))} · ${dayNames.length ? dayNames.join(', ') : this.text(T.noDays)}`;
		const pending = this.#val('controls.sprinkler.pending') === true;

		return [
			this.#section(
				open === false ? 'block' : 'drop',
				T.valve,
				valveChip,
				`<div class="row-buttons">
					${this.#button('valveOpen', 'drop', T.open, { disabled: !writable, cls: open === true ? 'selected' : '' })}
					${this.#button('valveClose', 'block', T.close, { disabled: !writable, cls: open === false ? 'selected' : '' })}
				</div>`,
			),
			this.#section(
				'gauge',
				T.pressureMeasurement,
				'',
				`<div class="row-buttons">${this.#button('pressure', 'play', T.start, {
					disabled: !writable || open === true,
					title: this.text(T.needsClosedValve),
				})}</div>`,
			),
			this.#section(
				'snooze',
				T.snooze,
				`<span class="chip${snoozeActive ? ' warn' : ''}">${esc(this.text(snoozeActive ? T.active : T.inactive))}</span>`,
				`<div class="row-buttons">
					${this.#button('snoozeStart', 'play', T.start, { disabled: !writable })}
					${this.#button('snoozeStop', 'stop', T.stop, { disabled: !writable || !snoozeActive })}
				</div>`,
			),
			this.#section(
				'limit',
				T.limit,
				`<span class="chip">${limit === null ? '–' : `${this.#num(limit, 0)} l`}</span>`,
				`<div class="row-buttons">${this.#button('limit', 'edit', T.change, { disabled: !writable })}</div>`,
			),
			this.#section(
				'schedule',
				T.sprinkler,
				pending ? `<span class="chip warn">${esc(this.text(T.unsaved))}</span>` : '',
				`<div class="detail">${esc(sprinkler)}</div>
				<div class="row-buttons">${this.#button('sprinkler', 'edit', T.edit, { disabled: !writable })}</div>`,
			),
		].join('');
	}

	/** @returns {number} tap type picked in the card, else the one of the adapter */
	#currentTapType() {
		return this.#tapType ?? (num(this.#val('controls.tapType')) || 1);
	}

	/** @returns {number} amount picked in the card, else the one of the adapter */
	#currentTapAmount() {
		return this.#tapAmount ?? clampAmount(num(this.#val('controls.tapAmount')) ?? 250);
	}

	/**
	 * @param {boolean} writable controls enabled
	 * @returns {string} HTML of the Blue controls
	 */
	#blueControls(writable) {
		const tapType = this.#currentTapType();
		const amount = this.#currentTapAmount();
		const dis = writable ? '' : 'disabled';
		return [
			this.#section(
				'drop',
				T.dispense,
				'',
				`<div class="label">${esc(this.text(T.tapType))}</div>
				<div class="row-buttons">
					${TAP_TYPES.map(
						t =>
							`<button class="btn${t.value === tapType ? ' selected' : ''}" data-tap-type="${t.value}" ${dis}>${esc(this.text(t.text))}</button>`,
					).join('')}
				</div>
				<div class="label">${esc(this.text(T.amount))}</div>
				<div class="amount">
					<button class="btn round" data-amount="-1" title="${esc(this.text(T.less))}" ${dis}>−</button>
					<div class="big">${this.#num(amount, 0)}<small>ml</small></div>
					<button class="btn round" data-amount="1" title="${esc(this.text(T.more))}" ${dis}>+</button>
				</div>
				<div class="row-buttons">${this.#button('dispense', 'drop', T.dispense, { disabled: !writable, cls: 'primary' })}</div>`,
			),
			this.#section(
				'reset',
				T.service,
				'',
				`<div class="row-buttons">
					${this.#button('resetCo2', 'bubbles', T.resetCo2, { disabled: !writable })}
					${this.#button('resetFilter', 'filter', T.resetFilter, { disabled: !writable })}
				</div>`,
			),
		].join('');
	}

	/** @param {Event} e click somewhere in the card */
	#onClick(e) {
		if (this.editMode) {
			return;
		}
		const target = /** @type {HTMLElement} */ (e.target).closest('button');
		if (!target || target.hasAttribute('disabled')) {
			return;
		}
		if (target.dataset.info) {
			// read-only: also while the appliance is offline
			this.#showInfo().catch(err => console.warn(`<${TAG}>: ${err}`));
			return;
		}
		if (target.dataset.tab) {
			this.#tab = target.dataset.tab === 'controls' ? 'controls' : 'info';
			this.render();
			return;
		}
		if (!this.#writable()) {
			return;
		}
		if (target.dataset.tapType) {
			this.#tapType = Number(target.dataset.tapType);
			this.render();
		} else if (target.dataset.amount) {
			this.#tapAmount = clampAmount(this.#currentTapAmount() + Number(target.dataset.amount) * TAP_STEP);
			this.render();
		} else if (target.dataset.action) {
			this.#onAction(target.dataset.action).catch(err => console.warn(`<${TAG}>: ${err}`));
		}
	}

	/**
	 * @param {unknown} value minutes
	 * @returns {string} e.g. `3 d 4 h` or `25 min`
	 */
	#duration(value) {
		const n = num(value);
		if (n === null) {
			return '–';
		}
		const days = Math.floor(n / 1440);
		const hours = Math.floor((n % 1440) / 60);
		if (days) {
			return `${days.toLocaleString(this.systemLang)} d${hours ? ` ${hours} h` : ''}`;
		}
		return hours ? `${hours} h ${Math.round(n % 60)} min` : `${Math.round(n)} min`;
	}

	/**
	 * @param {unknown} value value of a state
	 * @param {{kind: string, unit?: string, decimals?: number}} row row of the info dialog
	 * @returns {string} formatted value, empty if the appliance has none
	 */
	#infoValue(value, row) {
		if (value === null || value === undefined || value === '') {
			return '';
		}
		switch (row.kind) {
			case 'bool':
				return this.text(value === true || value === 'true' ? T.yes : T.no);
			case 'date':
				return this.#date(value);
			case 'minutes':
				return this.#duration(value);
			case 'num':
				return num(value) === null
					? ''
					: `${this.#num(value, row.decimals ?? 0)}${row.unit ? ` ${row.unit}` : ''}`;
			default:
				return String(value);
		}
	}

	/** Info dialog: general information that the card itself does not show */
	async #showInfo() {
		const base = this.#base;
		const socket = this.socket;
		if (!base || !socket) {
			return;
		}
		const type = this.#type;
		const sections = INFO_SECTIONS.filter(s => !s.types || s.types.includes(type));
		const ids = sections.flatMap(s => s.rows.map(r => `${base}.${r.state}`));
		const states = await Promise.all(ids.map(id => socket.getState(id).catch(() => null)));
		/** @type {Record<string, unknown>} */
		const values = Object.fromEntries(ids.map((id, i) => [id, states[i]?.val]));

		const applianceId = base.slice(base.indexOf('.', base.indexOf('.') + 1) + 1);
		const html = sections
			.map((section, i) => {
				const rows = section.rows
					.map(r => [r.label, this.#infoValue(values[`${base}.${r.state}`], r)])
					.filter(([, v]) => v !== '');
				if (i === 0) {
					rows.unshift(
						[T.applianceId, applianceId],
						[T.type, this.text(TYPES[/** @type {keyof TYPES} */ (type)]?.label || T.device)],
					);
				}
				return rows.length
					? `<h3>${esc(this.text(section.title))}</h3><table>${rows
							.map(
								([label, value]) =>
									`<tr><td>${esc(this.text(/** @type {{en: string, de: string}} */ (label)))}</td><td>${esc(value)}</td></tr>`,
							)
							.join('')}</table>`
					: '';
			})
			.join('');

		const element = document.createElement('div');
		// the element leaves the card, so it takes the theme with it
		for (const [name, value] of Object.entries(getThemeCssVariables(this.theme))) {
			element.style.setProperty(name, value);
		}
		element.attachShadow({ mode: 'open' }).innerHTML =
			`<style>${INFO_STYLE}</style>${html || `<div class="empty">${esc(this.text(T.noInfo))}</div>`}`;
		const name = this.text(this.objects[base]?.common?.name) || applianceId;
		await this.openDialog({ title: name, element, width: 480 });
	}

	/**
	 * A button of the controls: commands at once, values after a dialog
	 *
	 * @param {string} action data-action of the button
	 */
	async #onAction(action) {
		switch (action) {
			case 'valveOpen':
				return this.#send(action, { 'controls.valveOpen': true });
			case 'valveClose':
				return this.#send(action, { 'controls.valveClose': true });
			case 'pressure':
				return this.#send(action, { 'controls.startPressureMeasurement': true });
			case 'snoozeStop':
				return this.#send(action, { 'controls.snooze.stop': true });
			case 'snoozeStart': {
				const result = await this.openDialog({
					title: T.snooze,
					form: {
						type: 'panel',
						items: { duration: { type: 'number', label: T.duration, min: 1, max: 240, step: 1 } },
					},
					data: { duration: num(this.#val('controls.snooze.duration')) ?? 5 },
				});
				const duration = num(result?.duration);
				if (!result) {
					return;
				}
				// the duration is stored first: the adapter reads it when start arrives
				return this.#send(action, {
					...(duration !== null ? { 'controls.snooze.duration': duration } : {}),
					'controls.snooze.start': true,
				});
			}
			case 'limit': {
				const result = await this.openDialog({
					title: T.limit,
					form: {
						type: 'panel',
						items: { limit: { type: 'number', label: T.limitLabel, min: 0, max: 2000, step: 1 } },
					},
					data: { limit: num(this.#val('controls.withdrawalAmountLimit')) ?? 300 },
				});
				const limit = num(result?.limit);
				if (limit === null) {
					return;
				}
				return this.#send(action, { 'controls.withdrawalAmountLimit': limit });
			}
			case 'sprinkler':
				return this.#editSprinkler();
			case 'dispense':
				// type and amount first: the adapter reads both when the trigger arrives
				return this.#send(action, {
					'controls.tapType': this.#currentTapType(),
					'controls.tapAmount': this.#currentTapAmount(),
					'controls.dispenseTrigger': true,
				});
			case 'resetCo2':
			case 'resetFilter': {
				const co2 = action === 'resetCo2';
				const confirmed = await this.openDialog({
					title: co2 ? T.resetCo2 : T.resetFilter,
					form: {
						type: 'panel',
						items: {
							text: { type: 'staticText', text: co2 ? T.confirmResetCo2 : T.confirmResetFilter },
						},
					},
				});
				if (!confirmed) {
					return;
				}
				return this.#send(action, { [`controls.${action}`]: true });
			}
		}
	}

	/** Sprinkler mode: times and days in one dialog, then save in one call */
	async #editSprinkler() {
		/** @type {Record<string, Setting>} */
		const items = {};
		/** @type {Record<string, string | number | boolean>} */
		const data = {};
		const limits = { startHour: 23, startMinute: 59, stopHour: 23, stopMinute: 59 };
		for (const key of SPRINKLER_TIMES) {
			items[key] = {
				type: 'number',
				label: T[/** @type {keyof T} */ (key)],
				min: 0,
				max: limits[/** @type {keyof limits} */ (key)],
				step: 1,
			};
			data[key] = num(this.#val(`controls.sprinkler.${key}`)) ?? 0;
		}
		for (const day of DAYS) {
			items[`active${day}`] = { type: 'checkbox', label: T[/** @type {keyof T} */ (day)] };
			data[`active${day}`] = this.#val(`controls.sprinkler.active${day}`) === true;
		}
		const result = await this.openDialog({ title: T.sprinkler, form: { type: 'panel', items }, data });
		if (!result) {
			return;
		}
		/** @type {Record<string, ioBroker.StateValue>} */
		const values = {};
		for (const [key, val] of Object.entries(result)) {
			if (val !== undefined && val !== '' && key in items) {
				values[`controls.sprinkler.${key}`] = /** @type {ioBroker.StateValue} */ (val);
			}
		}
		values['controls.sprinkler.save'] = true;
		await this.#send('sprinkler', values);
	}

	/**
	 * Write the states of a command in this order: values first, the trigger last
	 *
	 * @param {string} action button that shows it is busy
	 * @param {Record<string, ioBroker.StateValue>} values states relative to the appliance
	 */
	async #send(action, values) {
		const base = this.#base;
		if (!base || !this.#writable()) {
			return;
		}
		this.#busy = action;
		clearTimeout(this.#busyTimer);
		this.#busyTimer = setTimeout(() => {
			this.#busy = '';
			this.render();
		}, BUSY_MS);
		this.render();
		for (const [state, val] of Object.entries(values)) {
			await this.setState(`${base}.${state}`, val);
		}
		if (action === 'dispense') {
			// the adapter has the values now; the next dispense starts from them
			this.#tapType = null;
			this.#tapAmount = null;
		}
	}
}

defineWebComponent(TAG, GroheDeviceCard);

export { GroheDeviceCard };

'use strict';

const utils = require('@iobroker/adapter-core');
const GroheClient = require('./lib/groheClient');

// Device type constants (same as GroheTypes in Python grohe package)
const GROHE_SENSE = 101;
const GROHE_SENSE_GUARD = 103;
const GROHE_BLUE_HOME = 104;
const GROHE_BLUE_PROFESSIONAL = 105;

// Notification categories
const NOTIFICATION_CATEGORIES = {
	10: 'Information',
	20: 'Warning',
	30: 'Alarm',
	40: 'WebURL',
};

class GroheSmarthome extends utils.Adapter {
	/** @param {Partial<utils.AdapterOptions>} [options] */
	constructor(options) {
		super({ ...options, name: 'grohe-smarthome' });

		this.client = null;
		this.pollTimer = null;

		/** Device registry – maps appliance_id to { locationId, roomId, applianceId, type, name } */
		this.devices = new Map();

		this.on('ready', this.onReady.bind(this));
		this.on('stateChange', this.onStateChange.bind(this));
		this.on('unload', this.onUnload.bind(this));
	}

	/* ================================================================== */
	/*  Startup                                                           */
	/* ================================================================== */

	async onReady() {
		await this.setState('info.connection', { val: false, ack: true });

		await this.setObjectNotExistsAsync('auth.refreshToken', {
			type: 'state',
			common: { name: 'Refresh Token', type: 'string', role: 'text', read: true, write: false },
			native: {},
		});

		try {
			this.client = new GroheClient(this.log);

			const email = (this.config.email || '').trim();
			const password = this.config.password || '';

			if (email) {
				const parts = email.split('@');
				const masked = parts.length === 2
					? `${parts[0].substring(0, 2)}***@${parts[1]}`
					: `${email.substring(0, 3)}***`;
				this.log.debug(`Verwende E-Mail: ${masked} (Länge: ${email.length})`);
			}
			this.log.debug(`Passwort vorhanden: ${password.length > 0}, Länge: ${password.length}`);

			// Read refresh token from state (not config – writing config triggers restart!)
			const savedRefreshState = await this.getStateAsync('auth.refreshToken');
			const savedRefresh = String(savedRefreshState?.val || '').trim();

			// 1) Try refresh token if present
			if (savedRefresh) {
				this.log.debug('Versuche gespeicherten Refresh-Token');
				this.client.setRefreshToken(savedRefresh);
				try {
					await this.client.refresh();
					this.log.info('Refresh-Token erfolgreich verwendet');
					await this._persistRefreshToken(this.client.refreshToken);
				} catch (err) {
					this.log.warn(`Refresh mit gespeichertem Token fehlgeschlagen: ${err.message}`);
					this.client.auth.accessToken = null;
					this.client.auth.refreshToken = null;
				}
			}

			// 2) Full login if no valid access token yet
			if (!this.client.accessToken) {
				if (!email || !password) {
					throw new Error('Bitte E-Mail und Passwort in den Adapter-Einstellungen setzen.');
				}
				this.log.info('Starte Login mit Benutzername/Passwort …');
				const tokens = await this.client.login(email, password);
				await this._persistRefreshToken(tokens.refresh_token);
			}

			await this.setState('info.connection', { val: true, ack: true });

			// 3) Initial poll
			await this.pollDevices();

			// 4) Set up polling interval
			const interval = Math.max(60, Number(this.config.pollInterval) || 300);
			this.pollTimer = setInterval(() => {
				this.pollDevices().catch(err => this.log.error(`Poll-Fehler: ${err.message}`));
			}, interval * 1000);
			this.log.info(`Polling aktiv: alle ${interval}s`);
		} catch (err) {
			await this.setState('info.connection', { val: false, ack: true });
			this.log.error(`Initialisierung fehlgeschlagen: ${err.message}`);
		}
	}

	/* ================================================================== */
	/*  Polling – Dashboard + Status + Command per device                 */
	/* ================================================================== */

	async pollDevices() {
		if (!this.client) {
			return;
		}

		try {
			const dashboard = await this.client.getDashboard();
			await this.setState('info.connection', { val: true, ack: true });

			const locations = dashboard?.locations || [];
			for (const location of locations) {
				const locationId = location.id;
				const rooms = location.rooms || [];

				for (const room of rooms) {
					const roomId = room.id;
					const appliances = room.appliances || [];

					for (const appliance of appliances) {
						if (appliance.registration_complete === false) {
							this.log.debug(`Appliance ${appliance.appliance_id} nicht registriert – übersprungen`);
							continue;
						}
						await this._processAppliance(locationId, roomId, appliance);
					}
				}
			}
		} catch (err) {
			await this.setState('info.connection', { val: false, ack: true });
			this.log.error(`pollDevices fehlgeschlagen: ${err.message}`);
		}
	}

	/* ================================================================== */
	/*  Process individual appliance from dashboard                       */
	/* ================================================================== */

	async _processAppliance(locationId, roomId, appliance) {
		const id = appliance.appliance_id;
		const type = appliance.type;
		const name = appliance.name || 'Grohe Device';

		this.devices.set(id, { locationId, roomId, applianceId: id, type, name });

		// Fetch status (online, update available, wifi quality)
		let status = null;
		try {
			const statusArr = await this.client.getApplianceStatus(locationId, roomId, id);
			status = this._parseStatusArray(statusArr);
		} catch (err) {
			this.log.debug(`Status-Abfrage für ${id} fehlgeschlagen: ${err.message}`);
		}

		switch (type) {
			case GROHE_SENSE:
				await this._updateSense(id, name, appliance, status);
				break;
			case GROHE_SENSE_GUARD:
				await this._updateSenseGuard(id, name, appliance, locationId, roomId, status);
				break;
			case GROHE_BLUE_HOME:
			case GROHE_BLUE_PROFESSIONAL:
				await this._updateBlue(id, name, appliance, type, status);
				break;
			default:
				await this._ensureDevice(id, name, `UNKNOWN_${type}`);
				this.log.debug(`Unbekannter Gerätetyp ${type} für ${id}`);
		}
	}

	/**
	 * Parse the status array from the API into a usable object.
	 * Status API returns: [{type: "update_available", value: false}, {type: "connection", value: true}, ...]
	 */
	_parseStatusArray(statusArr) {
		const result = {};
		if (!Array.isArray(statusArr)) {
			return result;
		}
		for (const entry of statusArr) {
			if (entry && entry.type) {
				result[entry.type] = entry.value;
			}
		}
		return result;
	}

	/* ================================================================== */
	/*  Sense (type 101)                                                  */
	/* ================================================================== */

	async _updateSense(id, name, appliance, status) {
		await this._ensureDevice(id, `${name} (Sense)`, 'SENSE');

		const m = appliance.data_latest?.measurement || {};

		// Sensors from HA config.yaml: GroheSense
		await this._setNum(id, 'temperature', 'Temperatur', '°C', 'value.temperature', m.temperature);
		await this._setNum(id, 'humidity', 'Luftfeuchte', '%', 'value.humidity', m.humidity);
		await this._setNum(id, 'battery', 'Batterie', '%', 'value.battery', m.battery);
		await this._setStr(id, 'lastMeasurement', 'Letzte Messung', 'date', m.timestamp);

		// Status channel (from status API)
		await this._updateStatusChannel(id, status);

		// Notifications
		await this._updateLatestNotification(id, appliance);

		// Raw measurement data
		await this._writeRaw(id, m);
	}

	/* ================================================================== */
	/*  Sense Guard (type 103)                                            */
	/* ================================================================== */

	async _updateSenseGuard(id, name, appliance, locationId, roomId, status) {
		await this._ensureDevice(id, `${name} (Sense Guard)`, 'SENSE_GUARD');

		const m = appliance.data_latest?.measurement || {};
		const dl = appliance.data_latest || {};

		// Temperature, flow, pressure
		await this._setNum(id, 'temperature', 'Wassertemperatur', '°C', 'value.temperature', m.temperature_guard);
		await this._setNum(id, 'flowRate', 'Aktueller Durchfluss', 'l/h', 'value.flow', m.flowrate);
		await this._setNum(id, 'pressure', 'Aktueller Druck', 'bar', 'value.pressure', m.pressure);
		await this._setStr(id, 'lastMeasurement', 'Letzte Messung', 'date', m.timestamp);

		// Consumption channel
		await this._ensureChannel(`${id}.consumption`, 'Verbrauch');
		await this._setNum(`${id}.consumption`, 'daily', 'Tagesverbrauch', 'l', 'value', dl.daily_consumption);
		await this._setNum(`${id}.consumption`, 'averageDaily', 'Durchschn. Tagesverbrauch', 'l', 'value', dl.average_daily_consumption);
		await this._setNum(`${id}.consumption`, 'averageMonthly', 'Durchschn. Monatsverbrauch', 'l', 'value', dl.average_monthly_consumption);

		// Withdrawals (latest)
		const w = dl.withdrawals || {};
		await this._setNum(`${id}.consumption`, 'lastWaterConsumption', 'Letzter Verbrauch', 'l', 'value', w.waterconsumption);
		await this._setNum(`${id}.consumption`, 'lastMaxFlowRate', 'Letzte max. Durchflussmenge', 'l/h', 'value', w.maxflowrate);

		// Valve state from command endpoint
		let valveOpen = undefined;
		try {
			const cmd = await this.client.getApplianceCommand(locationId, roomId, id);
			valveOpen = cmd?.command?.valve_open;
		} catch (err) {
			this.log.debug(`Command-Abfrage für ${id} fehlgeschlagen: ${err.message}`);
		}
		await this._setBool(id, 'valveOpen', 'Ventil offen', 'indicator', valveOpen);

		// Pressure measurement results
		try {
			const pm = await this.client.getAppliancePressureMeasurement(locationId, roomId, id);
			const items = Array.isArray(pm) ? pm : (pm?.items || pm?.data || []);
			if (items.length > 0) {
				const latest = items[0];
				await this._ensureChannel(`${id}.pressureMeasurement`, 'Druckmessung');
				await this._setNum(`${id}.pressureMeasurement`, 'dropOfPressure', 'Druckabfall', 'bar', 'value', latest.drop_of_pressure);
				await this._setBool(`${id}.pressureMeasurement`, 'isLeakage', 'Leckage erkannt', 'indicator', latest.leakage);
				await this._setStr(`${id}.pressureMeasurement`, 'leakageLevel', 'Leckage-Level', 'text', latest.level);
				await this._setStr(`${id}.pressureMeasurement`, 'startTime', 'Messzeit', 'date', latest.start_time);
			}
		} catch (err) {
			this.log.debug(`Druckmessung für ${id} fehlgeschlagen: ${err.message}`);
		}

		// Status channel
		await this._updateStatusChannel(id, status);

		// Notifications
		await this._updateLatestNotification(id, appliance);

		// Controls
		await this._ensureChannel(`${id}.controls`, 'Steuerung');
		await this._ensureWritableBool(`${id}.controls`, 'valveOpen', 'Ventil öffnen', 'button');
		await this._ensureWritableBool(`${id}.controls`, 'valveClose', 'Ventil schließen', 'button');
		await this._ensureWritableBool(`${id}.controls`, 'startPressureMeasurement', 'Druckmessung starten', 'button');

		// Raw measurement data
		await this._writeRaw(id, m);
	}

	/* ================================================================== */
	/*  Blue Home / Professional (type 104/105)                           */
	/* ================================================================== */

	async _updateBlue(id, name, appliance, type, status) {
		const typeStr = type === GROHE_BLUE_HOME ? 'Blue Home' : 'Blue Professional';
		await this._ensureDevice(id, `${name} (${typeStr})`, typeStr.toUpperCase().replace(' ', '_'));

		const m = appliance.data_latest?.measurement || {};

		// CO2 & Filter
		await this._setNum(id, 'remainingCo2', 'CO₂ Restmenge', '%', 'value.percent', m.remaining_co2);
		await this._setNum(id, 'remainingFilter', 'Filter Restlaufzeit', '%', 'value.percent', m.remaining_filter);
		await this._setNum(id, 'remainingCo2Liters', 'CO₂ Rest (Liter)', 'l', 'value', m.remaining_co2_liters);
		await this._setNum(id, 'remainingFilterLiters', 'Filter Rest (Liter)', 'l', 'value', m.remaining_filter_liters);

		// Cycles
		await this._setNum(id, 'cyclesCarbonated', 'Zyklen Sprudel', '', 'value', m.open_close_cycles_carbonated);
		await this._setNum(id, 'cyclesStill', 'Zyklen Still', '', 'value', m.open_close_cycles_still);

		// Times
		await this._setNum(id, 'operatingTime', 'Betriebszeit (min)', 'min', 'value', m.operating_time);
		await this._setNum(id, 'pumpRunningTime', 'Pumpenlaufzeit (min)', 'min', 'value', m.pump_running_time);
		await this._setNum(id, 'maxIdleTime', 'Max Leerlaufzeit (min)', 'min', 'value', m.max_idle_time);
		await this._setNum(id, 'timeSinceRestart', 'Zeit seit Neustart (min)', 'min', 'value', m.time_since_restart);

		// Water running times
		await this._setNum(id, 'waterRunningCarbonated', 'Wasser Sprudel (min)', 'min', 'value', m.water_running_time_carbonated);
		await this._setNum(id, 'waterRunningMedium', 'Wasser Medium (min)', 'min', 'value', m.water_running_time_medium);
		await this._setNum(id, 'waterRunningStill', 'Wasser Still (min)', 'min', 'value', m.water_running_time_still);

		// Dates
		await this._setStr(id, 'dateCleaning', 'Letzte Reinigung', 'date', m.date_of_cleaning);
		await this._setStr(id, 'dateCo2Replacement', 'Letzter CO₂-Wechsel', 'date', m.date_of_co2_replacement);
		await this._setStr(id, 'dateFilterReplacement', 'Letzter Filterwechsel', 'date', m.date_of_filter_replacement);
		await this._setStr(id, 'lastMeasurement', 'Letzte Messung', 'date', m.timestamp);

		// Counts
		await this._setNum(id, 'cleaningCount', 'Reinigungen', '', 'value', m.cleaning_count);
		await this._setNum(id, 'filterChangeCount', 'Filterwechsel', '', 'value', m.filter_change_count);
		await this._setNum(id, 'powerCutCount', 'Stromausfälle', '', 'value', m.power_cut_count);
		await this._setNum(id, 'pumpCount', 'Pump-Zyklen', '', 'value', m.pump_count);

		// Status channel
		await this._updateStatusChannel(id, status);

		// Notifications
		await this._updateLatestNotification(id, appliance);

		// Controls
		await this._ensureChannel(`${id}.controls`, 'Steuerung');
		await this._ensureWritableNum(`${id}.controls`, 'tapType', 'Zapf-Typ (1=still, 2=medium, 3=sprudel)', 'level', 1);
		await this._ensureWritableNum(`${id}.controls`, 'tapAmount', 'Menge (ml, Vielfaches von 50)', 'level', 250);
		await this._ensureWritableBool(`${id}.controls`, 'dispenseTrigger', 'Zapfen auslösen', 'button');
		await this._ensureWritableBool(`${id}.controls`, 'resetCo2', 'CO₂ Reset', 'button');
		await this._ensureWritableBool(`${id}.controls`, 'resetFilter', 'Filter Reset', 'button');

		// Raw measurement data
		await this._writeRaw(id, m);
	}

	/* ================================================================== */
	/*  Status channel (all devices)                                      */
	/* ================================================================== */

	async _updateStatusChannel(id, status) {
		await this._ensureChannel(`${id}.status`, 'Status');

		if (status) {
			await this._setBool(`${id}.status`, 'online', 'Online', 'indicator.reachable', status.connection);
			await this._setBool(`${id}.status`, 'updateAvailable', 'Update verfügbar', 'indicator', status.update_available);

			if (status.wifi_quality !== undefined) {
				await this._setNum(`${id}.status`, 'wifiQuality', 'WLAN-Qualität', '', 'value', status.wifi_quality);
			}
		}
	}

	/* ================================================================== */
	/*  Latest notification (all devices)                                 */
	/* ================================================================== */

	async _updateLatestNotification(id, appliance) {
		const notifications = appliance.notifications || [];
		if (notifications.length > 0) {
			const latest = notifications[0];
			const catName = NOTIFICATION_CATEGORIES[latest.category] || `Kategorie ${latest.category}`;
			const text = `[${catName}] ${latest.timestamp || ''}: Typ ${latest.type || latest.notification_type || '?'}`;

			await this._ensureChannel(`${id}.notifications`, 'Benachrichtigungen');
			await this._setStr(`${id}.notifications`, 'latest', 'Letzte Benachrichtigung', 'text', text);
			await this._setStr(`${id}.notifications`, 'latestTimestamp', 'Zeitpunkt', 'date', latest.timestamp);
			await this._setNum(`${id}.notifications`, 'latestCategory', 'Kategorie', '', 'value', latest.category);
			await this._setStr(`${id}.notifications`, 'latestCategoryName', 'Kategorie-Name', 'text', catName);
		}
	}

	/* ================================================================== */
	/*  State changes (write commands)                                    */
	/* ================================================================== */

	async onStateChange(stateId, state) {
		if (!state || state.ack || !this.client) {
			return;
		}

		try {
			const parts = stateId.split('.');
			const applianceId = parts[2];
			const dev = this.devices.get(applianceId);
			if (!dev) {
				this.log.warn(`Kein Gerät gefunden für ${stateId}`);
				return;
			}

			const { locationId, roomId } = dev;
			const tail = parts.slice(3).join('.');

			// Sense Guard: valve open
			if (tail === 'controls.valveOpen' && state.val) {
				this.log.info(`Ventil öffnen für ${applianceId}`);
				await this.client.setValve(locationId, roomId, applianceId, true);
				await this.setStateAsync(stateId, { val: false, ack: true });
				return;
			}
			// Sense Guard: valve close
			if (tail === 'controls.valveClose' && state.val) {
				this.log.info(`Ventil schließen für ${applianceId}`);
				await this.client.setValve(locationId, roomId, applianceId, false);
				await this.setStateAsync(stateId, { val: false, ack: true });
				return;
			}
			// Sense Guard: pressure measurement
			if (tail === 'controls.startPressureMeasurement' && state.val) {
				this.log.info(`Druckmessung starten für ${applianceId}`);
				await this.client.startPressureMeasurement(locationId, roomId, applianceId);
				await this.setStateAsync(stateId, { val: false, ack: true });
				return;
			}
			// Blue: dispense trigger
			if (tail === 'controls.dispenseTrigger' && state.val) {
				const typeState = await this.getStateAsync(`${this.namespace}.${applianceId}.controls.tapType`);
				const amountState = await this.getStateAsync(`${this.namespace}.${applianceId}.controls.tapAmount`);
				const tapType = Number(typeState?.val ?? 1);
				const tapAmount = Number(amountState?.val ?? 250);

				this.log.info(`Zapfen: Typ=${tapType} Menge=${tapAmount}ml für ${applianceId}`);
				await this.client.tapWater(locationId, roomId, applianceId, tapType, tapAmount);
				await this.setStateAsync(stateId, { val: false, ack: true });
				return;
			}
			// Blue: reset CO2
			if (tail === 'controls.resetCo2' && state.val) {
				this.log.info(`CO₂ Reset für ${applianceId}`);
				await this.client.resetCo2(locationId, roomId, applianceId);
				await this.setStateAsync(stateId, { val: false, ack: true });
				return;
			}
			// Blue: reset Filter
			if (tail === 'controls.resetFilter' && state.val) {
				this.log.info(`Filter Reset für ${applianceId}`);
				await this.client.resetFilter(locationId, roomId, applianceId);
				await this.setStateAsync(stateId, { val: false, ack: true });
				return;
			}
		} catch (err) {
			this.log.error(`Aktion fehlgeschlagen (${stateId}): ${err.message}`);
		}
	}

	/* ================================================================== */
	/*  Persist refresh token                                             */
	/* ================================================================== */

	async _persistRefreshToken(newToken) {
		const nt = String(newToken || '').trim();
		if (!nt) {
			return;
		}
		const current = await this.getStateAsync('auth.refreshToken');
		if (String(current?.val || '') === nt) {
			return;
		}
		await this.setState('auth.refreshToken', { val: nt, ack: true });
		this.log.debug('Refresh Token gespeichert');
	}

	/* ================================================================== */
	/*  Object helpers                                                    */
	/* ================================================================== */

	async _ensureDevice(id, name, type) {
		const obj = await this.getObjectAsync(id);
		if (!obj) {
			await this.setObject(id, {
				type: 'device',
				common: { name: `${name}` },
				native: { type },
			});
		}
	}

	async _ensureChannel(id, name) {
		const obj = await this.getObjectAsync(id);
		if (!obj) {
			await this.setObject(id, { type: 'channel', common: { name }, native: {} });
		}
	}

	async _ensureState(id, common) {
		const obj = await this.getObjectAsync(id);
		if (!obj) {
			await this.setObject(id, { type: 'state', common, native: {} });
		}
	}

	async _setNum(devId, name, label, unit, role, value) {
		const sid = `${devId}.${name}`;
		const common = { name: label, type: 'number', role, read: true, write: false };
		if (unit) {
			common.unit = unit;
		}
		await this._ensureState(sid, common);
		if (value !== undefined && value !== null) {
			await this.setState(sid, { val: value, ack: true });
		}
	}

	async _setBool(devId, name, label, role, value) {
		const sid = `${devId}.${name}`;
		await this._ensureState(sid, { name: label, type: 'boolean', role, read: true, write: false });
		if (value !== undefined && value !== null) {
			await this.setState(sid, { val: !!value, ack: true });
		}
	}

	async _setStr(devId, name, label, role, value) {
		const sid = `${devId}.${name}`;
		await this._ensureState(sid, { name: label, type: 'string', role, read: true, write: false });
		if (value !== undefined && value !== null) {
			await this.setState(sid, { val: String(value), ack: true });
		}
	}

	async _ensureWritableBool(devId, name, label, role) {
		const sid = `${devId}.${name}`;
		await this._ensureState(sid, { name: label, type: 'boolean', role, read: true, write: true });
		await this.subscribeStatesAsync(sid);
	}

	async _ensureWritableNum(devId, name, label, role, def) {
		const sid = `${devId}.${name}`;
		await this._ensureState(sid, { name: label, type: 'number', role, read: true, write: true, def });
		await this.subscribeStatesAsync(sid);
	}

	async _writeRaw(devId, measurement) {
		if (!measurement || typeof measurement !== 'object') {
			return;
		}

		await this._ensureChannel(`${devId}.raw`, 'Rohdaten');

		for (const [k, v] of Object.entries(measurement)) {
			if (v === null || v === undefined) {
				continue;
			}

			const sid = `${devId}.raw.${k}`;
			const t = typeof v;
			if (t === 'number') {
				await this._ensureState(sid, { name: k, type: 'number', role: 'value', read: true, write: false });
				await this.setState(sid, { val: v, ack: true });
			} else if (t === 'boolean') {
				await this._ensureState(sid, { name: k, type: 'boolean', role: 'indicator', read: true, write: false });
				await this.setState(sid, { val: v, ack: true });
			} else if (t === 'string') {
				await this._ensureState(sid, { name: k, type: 'string', role: 'text', read: true, write: false });
				await this.setState(sid, { val: v, ack: true });
			}
		}
	}

	/* ================================================================== */
	/*  Cleanup                                                           */
	/* ================================================================== */

	onUnload(callback) {
		try {
			if (this.pollTimer) {
				clearInterval(this.pollTimer);
			}
			this.client = null;
			callback();
		} catch {
			callback();
		}
	}
}

if (require.main !== module) {
	module.exports = options => new GroheSmarthome(options);
} else {
	new GroheSmarthome();
}

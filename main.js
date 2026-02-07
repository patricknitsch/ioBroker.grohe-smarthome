/* eslint-disable jsdoc/require-param */
'use strict';

const utils = require('@iobroker/adapter-core');
const GroheClient = require('./lib/groheClient');

// Device type constants (same as GroheTypes in Python grohe package)
const GROHE_SENSE = 101;
const GROHE_SENSE_GUARD = 103;
const GROHE_BLUE_HOME = 104;
const GROHE_BLUE_PROFESSIONAL = 105;

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
			common: { name: 'Refresh Token (encrypted)', type: 'string', role: 'text', read: true, write: false },
			native: {},
		});

		try {
			this.client = new GroheClient(this.log);

			const email = (this.config.email || '').trim();
			const password = this.config.password || '';

			if (email) {
				const parts = email.split('@');
				const masked =
					parts.length === 2 ? `${parts[0].substring(0, 2)}***@${parts[1]}` : `${email.substring(0, 3)}***`;
				this.log.debug(`Using email: ${masked} (length: ${email.length})`);
			}
			this.log.debug(`Password present: ${password.length > 0}, length: ${password.length}`);

			// Read refresh token from state (not config – writing config triggers restart!)
			const savedRefresh = await this._readRefreshToken();

			// 1) Try refresh token if present
			if (savedRefresh) {
				this.log.debug('Trying saved refresh token');
				this.client.setRefreshToken(savedRefresh);
				try {
					await this.client.refresh();
					this.log.info('Refresh token used successfully');
					await this._persistRefreshToken(this.client.refreshToken);
				} catch (err) {
					this.log.warn(`Refresh with saved token failed: ${err.message}`);
					this.client.auth.accessToken = null;
					this.client.auth.refreshToken = null;
				}
			}

			// 2) Full login if no valid access token yet
			if (!this.client.accessToken) {
				if (!email || !password) {
					throw new Error('Please set email and password in the adapter settings.');
				}
				this.log.info('Starting login with username/password...');
				const tokens = await this.client.login(email, password);
				await this._persistRefreshToken(tokens.refresh_token);
			}

			await this.setState('info.connection', { val: true, ack: true });

			// 3) Initial poll
			await this.pollDevices();

			// 4) Set up polling interval (minimum 30s)
			const interval = Math.max(30, Number(this.config.pollInterval) || 300);
			this.pollTimer = setInterval(() => {
				this.pollDevices().catch(err => this.log.error(`Poll error: ${err.message}`));
			}, interval * 1000);
			this.log.info(`Polling active: every ${interval}s`);
		} catch (err) {
			await this.setState('info.connection', { val: false, ack: true });
			this.log.error(`Initialization failed: ${err.message}`);
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
							this.log.debug(`Appliance ${appliance.appliance_id} not registered – skipped`);
							continue;
						}
						await this._processAppliance(locationId, roomId, appliance);
					}
				}
			}
		} catch (err) {
			await this.setState('info.connection', { val: false, ack: true });
			if (err?.response?.status === 403) {
				this.log.error(
					'Polling failed: HTTP 403 (Forbidden). Please check if the Grohe app is working correctly and your account is still active.',
				);
			} else {
				this.log.error(`pollDevices failed: ${err.message}`);
			}
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
			this.log.debug(`Status query for ${id} failed: ${err.message}`);
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
				this.log.debug(`Unknown device type ${type} for ${id}`);
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

		await this._setNum(id, 'temperature', 'Temperature', '°C', 'value.temperature', m.temperature);
		await this._setNum(id, 'humidity', 'Humidity', '%', 'value.humidity', m.humidity);
		await this._setNum(
			id,
			'battery',
			'Battery',
			'%',
			'level.battery',
			typeof m.battery === 'number' ? m.battery : undefined,
		);
		await this._setStr(id, 'lastMeasurement', 'Last measurement', 'date', m.timestamp);

		// Status channel (from status API)
		await this._updateStatusChannel(id, status);

		// Notifications
		await this._updateLatestNotification(id, appliance);

		// Raw measurement data (optional)
		if (this.config.rawStates) {
			await this._writeRaw(id, m);
		}
	}

	/* ================================================================== */
	/*  Sense Guard (type 103)                                            */
	/* ================================================================== */

	async _updateSenseGuard(id, name, appliance, locationId, roomId, status) {
		await this._ensureDevice(id, `${name} (Sense Guard)`, 'SENSE_GUARD');

		const m = appliance.data_latest?.measurement || {};
		const dl = appliance.data_latest || {};

		// Temperature, flow, pressure
		await this._setNum(id, 'temperature', 'Water temperature', '°C', 'value.temperature', m.temperature_guard);
		await this._setNum(id, 'flowRate', 'Current flow rate', 'l/h', 'value.flow', m.flowrate);
		await this._setNum(id, 'pressure', 'Current pressure', 'bar', 'value.pressure', m.pressure);
		await this._setStr(id, 'lastMeasurement', 'Last measurement', 'date', m.timestamp);

		// Consumption channel
		await this._ensureChannel(`${id}.consumption`, 'Consumption');
		await this._setNum(`${id}.consumption`, 'daily', 'Daily consumption', 'l', 'value', dl.daily_consumption);
		await this._setNum(
			`${id}.consumption`,
			'averageDaily',
			'Average daily consumption',
			'l',
			'value',
			dl.average_daily_consumption,
		);
		await this._setNum(
			`${id}.consumption`,
			'averageMonthly',
			'Average monthly consumption',
			'l',
			'value',
			dl.average_monthly_consumption,
		);
		await this._setNum(
			`${id}.consumption`,
			'totalWaterConsumption',
			'Total water consumption',
			'l',
			'value',
			dl.total_water_consumption ?? dl.water_consumption,
		);

		// Withdrawals (latest)
		const w = dl.withdrawals || {};
		await this._setNum(
			`${id}.consumption`,
			'lastWaterConsumption',
			'Last water consumption',
			'l',
			'value',
			w.waterconsumption,
		);
		await this._setNum(`${id}.consumption`, 'lastMaxFlowRate', 'Last max flow rate', 'l/h', 'value', w.maxflowrate);

		// Valve state from command endpoint
		let valveOpen = undefined;
		try {
			const cmd = await this.client.getApplianceCommand(locationId, roomId, id);
			valveOpen = cmd?.command?.valve_open;
		} catch (err) {
			this.log.debug(`Command query for ${id} failed: ${err.message}`);
		}
		await this._setBool(id, 'valveOpen', 'Valve open', 'indicator', valveOpen);

		// Pressure measurement results (may return 404 if never executed)
		try {
			const pm = await this.client.getAppliancePressureMeasurement(locationId, roomId, id);
			const items = Array.isArray(pm) ? pm : pm?.items || pm?.data || [];
			if (items.length > 0) {
				const latest = items[0];
				await this._ensureChannel(`${id}.pressureMeasurement`, 'Pressure measurement');
				await this._setNum(
					`${id}.pressureMeasurement`,
					'dropOfPressure',
					'Pressure drop',
					'bar',
					'value',
					latest.drop_of_pressure,
				);
				await this._setBool(
					`${id}.pressureMeasurement`,
					'isLeakage',
					'Leakage detected',
					'indicator',
					latest.leakage,
				);
				await this._setStr(`${id}.pressureMeasurement`, 'leakageLevel', 'Leakage level', 'text', latest.level);
				await this._setStr(
					`${id}.pressureMeasurement`,
					'startTime',
					'Measurement time',
					'date',
					latest.start_time,
				);
			}
		} catch (err) {
			if (err?.response?.status === 404) {
				this.log.debug(`Pressure measurement not available for ${id} (HTTP 404 – no measurement data yet)`);
			} else {
				this.log.debug(`Pressure measurement for ${id} failed: ${err.message}`);
			}
		}

		// Status channel
		await this._updateStatusChannel(id, status);

		// Notifications
		await this._updateLatestNotification(id, appliance);

		// Controls
		await this._ensureChannel(`${id}.controls`, 'Controls');
		await this._ensureWritableBool(`${id}.controls`, 'valveOpen', 'Open valve', 'button');
		await this._ensureWritableBool(`${id}.controls`, 'valveClose', 'Close valve', 'button');
		await this._ensureWritableBool(
			`${id}.controls`,
			'startPressureMeasurement',
			'Start pressure measurement',
			'button',
		);

		// Raw measurement data (optional)
		if (this.config.rawStates) {
			await this._writeRaw(id, m);
		}
	}

	/* ================================================================== */
	/*  Blue Home / Professional (type 104/105)                           */
	/* ================================================================== */

	async _updateBlue(id, name, appliance, type, status) {
		const typeStr = type === GROHE_BLUE_HOME ? 'Blue Home' : 'Blue Professional';
		await this._ensureDevice(id, `${name} (${typeStr})`, typeStr.toUpperCase().replace(' ', '_'));

		const m = appliance.data_latest?.measurement || {};

		// CO2 & Filter
		await this._setNum(id, 'remainingCo2', 'Remaining CO₂', '%', 'value', m.remaining_co2);
		await this._setNum(id, 'remainingFilter', 'Remaining filter', '%', 'value', m.remaining_filter);
		await this._setNum(id, 'remainingCo2Liters', 'Remaining CO₂ (liters)', 'l', 'value', m.remaining_co2_liters);
		await this._setNum(
			id,
			'remainingFilterLiters',
			'Remaining filter (liters)',
			'l',
			'value',
			m.remaining_filter_liters,
		);

		// Cycles
		await this._setNum(id, 'cyclesCarbonated', 'Cycles carbonated', '', 'value', m.open_close_cycles_carbonated);
		await this._setNum(id, 'cyclesStill', 'Cycles still', '', 'value', m.open_close_cycles_still);

		// Times
		await this._setNum(id, 'operatingTime', 'Operating time', 'min', 'value', m.operating_time);
		await this._setNum(id, 'pumpRunningTime', 'Pump running time', 'min', 'value', m.pump_running_time);
		await this._setNum(id, 'maxIdleTime', 'Max idle time', 'min', 'value', m.max_idle_time);
		await this._setNum(id, 'timeSinceRestart', 'Time since restart', 'min', 'value', m.time_since_restart);

		// Water running times
		await this._setNum(
			id,
			'waterRunningCarbonated',
			'Water running carbonated',
			'min',
			'value',
			m.water_running_time_carbonated,
		);
		await this._setNum(
			id,
			'waterRunningMedium',
			'Water running medium',
			'min',
			'value',
			m.water_running_time_medium,
		);
		await this._setNum(id, 'waterRunningStill', 'Water running still', 'min', 'value', m.water_running_time_still);

		// Dates
		await this._setStr(id, 'dateCleaning', 'Last cleaning', 'date', m.date_of_cleaning);
		await this._setStr(id, 'dateCo2Replacement', 'Last CO₂ replacement', 'date', m.date_of_co2_replacement);
		await this._setStr(
			id,
			'dateFilterReplacement',
			'Last filter replacement',
			'date',
			m.date_of_filter_replacement,
		);
		await this._setStr(id, 'lastMeasurement', 'Last measurement', 'date', m.timestamp);

		// Counts
		await this._setNum(id, 'cleaningCount', 'Cleaning count', '', 'value', m.cleaning_count);
		await this._setNum(id, 'filterChangeCount', 'Filter changes', '', 'value', m.filter_change_count);
		await this._setNum(id, 'powerCutCount', 'Power cuts', '', 'value', m.power_cut_count);
		await this._setNum(id, 'pumpCount', 'Pump cycles', '', 'value', m.pump_count);

		// Status channel
		await this._updateStatusChannel(id, status);

		// Notifications
		await this._updateLatestNotification(id, appliance);

		// Controls
		await this._ensureChannel(`${id}.controls`, 'Controls');
		await this._ensureWritableNum(
			`${id}.controls`,
			'tapType',
			'Tap type (1=still, 2=medium, 3=carbonated)',
			'level',
			1,
		);
		await this._ensureWritableNum(`${id}.controls`, 'tapAmount', 'Amount (ml, multiples of 50)', 'level', 250);
		await this._ensureWritableBool(`${id}.controls`, 'dispenseTrigger', 'Dispense', 'button');
		await this._ensureWritableBool(`${id}.controls`, 'resetCo2', 'Reset CO₂', 'button');
		await this._ensureWritableBool(`${id}.controls`, 'resetFilter', 'Reset filter', 'button');

		// Raw measurement data (optional)
		if (this.config.rawStates) {
			await this._writeRaw(id, m);
		}
	}

	/* ================================================================== */
	/*  Status channel (all devices)                                      */
	/* ================================================================== */

	async _updateStatusChannel(id, status) {
		await this._ensureChannel(`${id}.status`, 'Status');

		if (status) {
			await this._setBool(`${id}.status`, 'online', 'Online', 'indicator.reachable', status.connection);
			await this._setBool(
				`${id}.status`,
				'updateAvailable',
				'Update available',
				'indicator',
				status.update_available,
			);

			if (status.wifi_quality !== undefined) {
				await this._setNum(`${id}.status`, 'wifiQuality', 'WiFi quality', '', 'value', status.wifi_quality);
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
			const catName = NOTIFICATION_CATEGORIES[latest.category] || `Category ${latest.category}`;
			const message = latest.message || latest.body || latest.text || '';

			await this._ensureChannel(`${id}.notifications`, 'Notifications');
			await this._setStr(
				`${id}.notifications`,
				'latestMessage',
				'Latest notification message',
				'text',
				message || `Type ${latest.type || latest.notification_type || '?'}`,
			);
			await this._setStr(`${id}.notifications`, 'latestTimestamp', 'Timestamp', 'date', latest.timestamp);
			await this._setNum(`${id}.notifications`, 'latestCategory', 'Category', '', 'value', latest.category);
			await this._setStr(`${id}.notifications`, 'latestCategoryName', 'Category name', 'text', catName);
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
				this.log.warn(`No device found for ${stateId}`);
				return;
			}

			const { locationId, roomId } = dev;
			const tail = parts.slice(3).join('.');

			// Sense Guard: valve open
			if (tail === 'controls.valveOpen' && state.val) {
				this.log.info(`Opening valve for ${applianceId}`);
				await this.client.setValve(locationId, roomId, applianceId, true);
				await this.setStateAsync(stateId, { val: false, ack: true });
				return;
			}
			// Sense Guard: valve close
			if (tail === 'controls.valveClose' && state.val) {
				this.log.info(`Closing valve for ${applianceId}`);
				await this.client.setValve(locationId, roomId, applianceId, false);
				await this.setStateAsync(stateId, { val: false, ack: true });
				return;
			}
			// Sense Guard: pressure measurement
			if (tail === 'controls.startPressureMeasurement' && state.val) {
				this.log.info(`Starting pressure measurement for ${applianceId}`);
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

				this.log.info(`Dispensing: type=${tapType} amount=${tapAmount}ml for ${applianceId}`);
				await this.client.tapWater(locationId, roomId, applianceId, tapType, tapAmount);
				await this.setStateAsync(stateId, { val: false, ack: true });
				return;
			}
			// Blue: reset CO2
			if (tail === 'controls.resetCo2' && state.val) {
				this.log.info(`Resetting CO₂ for ${applianceId}`);
				await this.client.resetCo2(locationId, roomId, applianceId);
				await this.setStateAsync(stateId, { val: false, ack: true });
				return;
			}
			// Blue: reset Filter
			if (tail === 'controls.resetFilter' && state.val) {
				this.log.info(`Resetting filter for ${applianceId}`);
				await this.client.resetFilter(locationId, roomId, applianceId);
				await this.setStateAsync(stateId, { val: false, ack: true });
				return;
			}
		} catch (err) {
			this.log.error(`Action failed (${stateId}): ${err.message}`);
		}
	}

	/* ================================================================== */
	/*  Persist / read refresh token (encrypted in state)                 */
	/* ================================================================== */

	async _persistRefreshToken(newToken) {
		const nt = String(newToken || '').trim();
		if (!nt) {
			return;
		}
		const encrypted = this.encrypt(nt);
		const current = await this.getStateAsync('auth.refreshToken');
		const currentVal = String(current?.val || '');
		if (currentVal === `enc:${encrypted}`) {
			return;
		}
		await this.setState('auth.refreshToken', { val: `enc:${encrypted}`, ack: true });
		this.log.debug('Refresh token saved (encrypted)');
	}

	async _readRefreshToken() {
		const state = await this.getStateAsync('auth.refreshToken');
		let raw = String(state?.val || '').trim();
		if (!raw) {
			return '';
		}
		// Encrypted tokens are prefixed with "enc:"
		if (raw.startsWith('enc:')) {
			return this.decrypt(raw.substring(4));
		}
		// Legacy: unencrypted token from older version – migrate to encrypted
		this.log.debug('Migrating unencrypted refresh token to encrypted storage');
		await this._persistRefreshToken(raw);
		return raw;
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
			await this.setState(sid, { val: Number(value), ack: true });
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

		await this._ensureChannel(`${devId}.raw`, 'Raw data');

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

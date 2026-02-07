'use strict';

const utils = require('@iobroker/adapter-core');
const GroheClient = require('./lib/groheClient');

// Device type constants (same as GroheTypes in Python grohe package)
const GROHE_SENSE = 101;
const GROHE_SENSE_GUARD = 103;
const GROHE_BLUE_HOME = 104;
const GROHE_BLUE_PROFESSIONAL = 105;

class GroheSmarthome extends utils.Adapter {
	/** @param {Partial<utils.AdapterOptions>} [options] */
	constructor(options) {
		super({ ...options, name: 'grohe-smarthome' });

		this.client = null;

		this.pollTimer = null;

		/**
		 * Device registry – maps appliance_id to { locationId, roomId, applianceId, type, name }
		 *
		 */
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

		// Ensure the refresh token state exists (stored here to avoid adapter restarts)
		await this.setObjectNotExistsAsync('auth.refreshToken', {
			type: 'state',
			common: { name: 'Refresh Token', type: 'string', role: 'text', read: true, write: false },
			native: {},
		});

		try {
			this.client = new GroheClient(this.log);

			const email = (this.config.email || '').trim();
			const password = this.config.password || '';

			// Debug: show email being used (helps diagnose encryption mismatches)
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
					// Persist possibly updated refresh token
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
	/*  Polling – Dashboard based (like HA integration)                   */
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

		// Store routing info for commands
		this.devices.set(id, { locationId, roomId, applianceId: id, type, name });

		switch (type) {
			case GROHE_SENSE:
				await this._updateSense(id, name, appliance);
				break;
			case GROHE_SENSE_GUARD:
				await this._updateSenseGuard(id, name, appliance);
				break;
			case GROHE_BLUE_HOME:
			case GROHE_BLUE_PROFESSIONAL:
				await this._updateBlue(id, name, appliance, type);
				break;
			default:
				await this._ensureDevice(id, name, `UNKNOWN_${type}`);
				this.log.debug(`Unbekannter Gerätetyp ${type} für ${id}`);
		}
	}

	/* ================================================================== */
	/*  Sense                                                             */
	/* ================================================================== */

	async _updateSense(id, name, appliance) {
		await this._ensureDevice(id, `${name} (Sense)`, 'SENSE');

		const m = appliance.data_latest?.measurement || {};
		await this._setNum(id, 'temperature', 'Temperatur', 'value.temperature', m.temperature);
		await this._setNum(id, 'humidity', 'Luftfeuchte', 'value.humidity', m.humidity);
		await this._setBool(
			id,
			'battery',
			'Batterie niedrig',
			'indicator.lowbat',
			Array.isArray(appliance.status)
				? appliance.status.some(s => s.type === 'battery' && s.value === 'low')
				: undefined,
		);
		await this._setNum(
			id,
			'batteryLevel',
			'Batterie',
			'value.battery',
			typeof m.battery === 'number' ? m.battery : undefined,
		);

		await this._writeRaw(id, m);
	}

	/* ================================================================== */
	/*  Sense Guard                                                       */
	/* ================================================================== */

	async _updateSenseGuard(id, name, appliance) {
		await this._ensureDevice(id, `${name} (Sense Guard)`, 'SENSE_GUARD');

		const m = appliance.data_latest?.measurement || {};
		await this._setNum(id, 'flowRate', 'Durchfluss (l/h)', 'value.flow', m.flowrate);
		await this._setNum(id, 'pressure', 'Druck (bar)', 'value.pressure', m.pressure);
		await this._setNum(id, 'waterTemperature', 'Wassertemperatur', 'value.temperature', m.temperature_guard);

		// Valve state from status array
		const valveStatus = Array.isArray(appliance.status) ? appliance.status.find(s => s.type === 'open') : null;
		if (valveStatus) {
			await this._setBool(
				id,
				'valveOpen',
				'Ventil offen',
				'indicator.open',
				valveStatus.value === true || valveStatus.value === 'open',
			);
		}

		// Controls
		await this._ensureChannel(`${id}.controls`, 'Steuerung');
		await this._ensureWritableBool(`${id}.controls`, 'valveOpen', 'Ventil öffnen', 'button');
		await this._ensureWritableBool(`${id}.controls`, 'valveClose', 'Ventil schließen', 'button');

		await this._writeRaw(id, m);
	}

	/* ================================================================== */
	/*  Blue Home / Professional                                          */
	/* ================================================================== */

	async _updateBlue(id, name, appliance, type) {
		const typeStr = type === GROHE_BLUE_HOME ? 'Blue Home' : 'Blue Professional';
		await this._ensureDevice(id, `${name} (${typeStr})`, typeStr.toUpperCase().replace(' ', '_'));

		const m = appliance.data_latest?.measurement || {};
		await this._setNum(id, 'remainingCo2', 'CO₂ Füllstand (%)', 'value.percent', m.remaining_co2);
		await this._setNum(id, 'remainingFilter', 'Filter Restlaufzeit (%)', 'value.percent', m.remaining_filter);
		await this._setNum(id, 'remainingCo2Liters', 'CO₂ Rest (Liter)', 'value', m.remaining_co2_liters);
		await this._setNum(id, 'remainingFilterLiters', 'Filter Rest (Liter)', 'value', m.remaining_filter_liters);
		await this._setNum(id, 'cleaningCount', 'Reinigungen', 'value', m.cleaning_count);
		await this._setNum(id, 'pumpCount', 'Pump-Zyklen', 'value', m.pump_count);
		await this._setNum(id, 'operatingTime', 'Betriebszeit (min)', 'value', m.operating_time);

		// Controls
		await this._ensureChannel(`${id}.controls`, 'Steuerung');
		await this._ensureWritableNum(
			`${id}.controls`,
			'tapType',
			'Zapf-Typ (1=still, 2=medium, 3=sprudel)',
			'level',
			1,
		);
		await this._ensureWritableNum(`${id}.controls`, 'tapAmount', 'Menge (ml, Vielfaches von 50)', 'level', 250);
		await this._ensureWritableBool(`${id}.controls`, 'dispenseTrigger', 'Zapfen auslösen', 'button');

		await this._writeRaw(id, m);
	}

	/* ================================================================== */
	/*  State changes (write commands)                                    */
	/* ================================================================== */

	async onStateChange(stateId, state) {
		if (!state || state.ack || !this.client) {
			return;
		}

		try {
			// Find device from state id: grohe-smarthome.0.<applianceId>...
			const parts = stateId.split('.');
			// parts: [adapter, instance, applianceId, ...]
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
		} catch (err) {
			this.log.error(`Aktion fehlgeschlagen (${stateId}): ${err.message}`);
		}
	}

	/* ================================================================== */
	/*  Persist refresh token to adapter config                           */
	/* ================================================================== */

	async _persistRefreshToken(newToken) {
		const nt = String(newToken || '').trim();
		if (!nt) {
			return;
		}
		// Read current value to avoid unnecessary writes
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

	async _setNum(devId, name, label, role, value) {
		const sid = `${devId}.${name}`;
		await this._ensureState(sid, { name: label, type: 'number', role, read: true, write: false });
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

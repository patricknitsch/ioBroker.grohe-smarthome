'use strict';

/**
 * Grohe API client – mirrors the Python groheblue client.py + controller.py.
 *
 * Uses GroheAuth for token management and exposes high-level methods for
 * dashboard, appliance data, commands, valve control, etc.
 */

const axios = require('axios');
const GroheAuth = require('./auth');

const BASE = 'https://idp2-apigw.cloud.grohe.com/v3/iot';

class GroheClient {
	/**
	 * @param {object} log – adapter.log compatible logger
	 */
	constructor(log) {
		this.log = log;
		this.auth = new GroheAuth(log);
		this.http = axios.create({ timeout: 15000 });
	}

	/* ================================================================== */
	/*  Authentication                                                    */
	/* ================================================================== */

	/**
	 * Full login with username + password.
	 *
	 * @param {string} email
	 * @param {string} password
	 */
	async login(email, password) {
		return this.auth.login(email, password);
	}

	/**
	 * Set a previously-saved refresh token (skip full login).
	 *
	 * @param {string} token
	 */
	setRefreshToken(token) {
		this.auth.refreshToken = String(token || '').trim();
	}

	/**
	 * Try to obtain a new access token using the stored refresh token.
	 */
	async refresh() {
		return this.auth.refresh();
	}

	/** @returns {string|null} current access token */
	get accessToken() {
		return this.auth.accessToken;
	}

	/** @returns {string|null} current refresh token */
	get refreshToken() {
		return this.auth.refreshToken;
	}

	/* ================================================================== */
	/*  Generic authenticated request (auto-refresh on 401)               */
	/* ================================================================== */

	/**
	 * @param {import('axios').AxiosRequestConfig} config
	 * @param {boolean} [retry]
	 */
	async request(config, retry = true) {
		const token = await this.auth.getAccessToken();
		config.headers = {
			...(config.headers || {}),
			Authorization: `Bearer ${token}`,
			'Content-Type': 'application/json',
		};

		try {
			return await this.http.request(config);
		} catch (err) {
			if (err?.response?.status === 401 && retry) {
				this.log.debug('[client] 401 – refreshing token and retrying');
				await this.auth.refresh();
				return this.request(config, false);
			}
			throw err;
		}
	}

	/* ================================================================== */
	/*  Dashboard                                                         */
	/* ================================================================== */

	/**
	 * Get the full dashboard (locations → rooms → appliances).
	 *
	 * @returns {Promise<object>}
	 */
	async getDashboard() {
		const resp = await this.request({ method: 'GET', url: `${BASE}/dashboard` });
		return resp.data;
	}

	/* ================================================================== */
	/*  Appliance helpers                                                 */
	/* ================================================================== */

	_applianceUrl(locationId, roomId, applianceId) {
		return `${BASE}/locations/${locationId}/rooms/${roomId}/appliances/${applianceId}`;
	}

	/**
	 * @param locationId
	 * @param roomId
	 * @param applianceId
	 * @returns {Promise<object>}
	 */
	async getApplianceDetails(locationId, roomId, applianceId) {
		const url = `${this._applianceUrl(locationId, roomId, applianceId)}/details`;
		const resp = await this.request({ method: 'GET', url });
		return resp.data;
	}

	/**
	 * @param locationId
	 * @param roomId
	 * @param applianceId
	 * @param {string} dateFrom – ISO date string
	 * @param {string} dateTo   – ISO date string
	 * @param {string} [groupBy]
	 * @returns {Promise<object>}
	 */
	async getApplianceData(locationId, roomId, applianceId, dateFrom, dateTo, groupBy = 'hour') {
		const url = `${this._applianceUrl(locationId, roomId, applianceId)}/data`;
		const resp = await this.request({
			method: 'GET',
			url,
			params: {
				from: dateFrom,
				to: dateTo,
				groupBy,
			},
		});
		return resp.data;
	}

	/**
	 * Get appliance command capabilities.
	 *
	 * @param locationId
	 * @param roomId
	 * @param applianceId
	 * @returns {Promise<object|null>}
	 */
	async getApplianceCommand(locationId, roomId, applianceId) {
		const url = `${this._applianceUrl(locationId, roomId, applianceId)}/command`;
		const resp = await this.request({ method: 'GET', url });
		return resp.data;
	}

	/**
	 * Send a command to an appliance (valve, tap, etc.).
	 *
	 * @param locationId
	 * @param roomId
	 * @param applianceId
	 * @param {object} commandData – { command: { … } }
	 * @returns {Promise<object>}
	 */
	async setApplianceCommand(locationId, roomId, applianceId, commandData) {
		const url = `${this._applianceUrl(locationId, roomId, applianceId)}/command`;
		const resp = await this.request({ method: 'POST', url, data: commandData });
		return resp.data;
	}

	/**
	 * @param locationId
	 * @param roomId
	 * @param applianceId
	 * @returns {Promise<Array>}
	 */
	async getApplianceStatus(locationId, roomId, applianceId) {
		const url = `${this._applianceUrl(locationId, roomId, applianceId)}/status`;
		const resp = await this.request({ method: 'GET', url });
		return resp.data;
	}

	/**
	 * @param locationId
	 * @param roomId
	 * @param applianceId
	 * @returns {Promise<Array>}
	 */
	async getApplianceNotifications(locationId, roomId, applianceId) {
		const url = `${this._applianceUrl(locationId, roomId, applianceId)}/notifications`;
		const resp = await this.request({ method: 'GET', url });
		return resp.data;
	}

	/**
	 * @param locationId
	 * @param roomId
	 * @param applianceId
	 * @returns {Promise<object>}
	 */
	async getAppliancePressureMeasurement(locationId, roomId, applianceId) {
		const url = `${this._applianceUrl(locationId, roomId, applianceId)}/pressure/measurements`;
		const resp = await this.request({ method: 'GET', url });
		return resp.data;
	}

	/* ================================================================== */
	/*  Sense Guard – valve                                               */
	/* ================================================================== */

	/**
	 * Open or close the Sense Guard valve.
	 *
	 * @param locationId
	 * @param roomId
	 * @param applianceId
	 * @param {boolean} open
	 */
	async setValve(locationId, roomId, applianceId, open) {
		const command = {
			valve_open: open,
		};
		return this.setApplianceCommand(locationId, roomId, applianceId, {
			type: null,
			appliance_id: applianceId,
			command,
			commandb64: null,
			timestamp: null,
		});
	}

	/**
	 * Set snooze on a Sense Guard.
	 *
	 * @param locationId
	 * @param roomId
	 * @param applianceId
	 * @param {number} duration – snooze duration in minutes
	 */
	async setSnooze(locationId, roomId, applianceId, duration) {
		const command = { snooze_duration: duration };
		return this.setApplianceCommand(locationId, roomId, applianceId, {
			type: null,
			appliance_id: applianceId,
			command,
			commandb64: null,
			timestamp: null,
		});
	}

	/* ================================================================== */
	/*  Blue – water dispensing                                           */
	/* ================================================================== */

	/**
	 * Tap water from a Grohe Blue device.
	 *
	 * @param locationId
	 * @param roomId
	 * @param applianceId
	 * @param {number} tapType  – 1=still, 2=medium, 3=sparkling
	 * @param {number} amount   – amount in ml (multiples of 50)
	 */
	async tapWater(locationId, roomId, applianceId, tapType, amount) {
		const command = {
			co2_status_reset: false,
			tap_type: tapType,
			cleaning_mode: false,
			filter_status_reset: false,
			get_current_measurement: false,
			tap_amount: amount,
			factory_reset: false,
			revoke_flush_confirmation: false,
			exec_auto_flush: false,
		};
		return this.setApplianceCommand(locationId, roomId, applianceId, {
			type: null,
			appliance_id: applianceId,
			command,
			commandb64: null,
			timestamp: null,
		});
	}

	/* ================================================================== */
	/*  Profile notifications                                             */
	/* ================================================================== */

	/**
	 * @param {number} [limit]
	 * @returns {Promise<Array>}
	 */
	async getProfileNotifications(limit = 50) {
		const resp = await this.request({
			method: 'GET',
			url: `${BASE}/profile/notifications`,
			params: { limit },
		});
		return resp.data;
	}
}

module.exports = GroheClient;

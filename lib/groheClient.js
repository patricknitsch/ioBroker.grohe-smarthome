/* eslint-disable jsdoc/require-jsdoc */
'use strict';

/**
 * Grohe API client – mirrors the Python grohe client.py.
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

	async login(email, password) {
		return this.auth.login(email, password);
	}

	setRefreshToken(token) {
		this.auth.refreshToken = String(token || '').trim();
	}

	async refresh() {
		return this.auth.refresh();
	}

	get accessToken() {
		return this.auth.accessToken;
	}

	get refreshToken() {
		return this.auth.refreshToken;
	}

	/* ================================================================== */
	/*  Generic authenticated request (auto-refresh on 401)               */
	/* ================================================================== */

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
			if (err?.response?.status === 403) {
				this.log.warn(
					`[client] HTTP 403 (Forbidden) for ${config.url}. Please check if the Grohe app is working correctly and your account is still active.`,
				);
			}
			throw err;
		}
	}

	/* ================================================================== */
	/*  Dashboard                                                         */
	/* ================================================================== */

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

	async getApplianceDetails(locationId, roomId, applianceId) {
		const url = `${this._applianceUrl(locationId, roomId, applianceId)}/details`;
		const resp = await this.request({ method: 'GET', url });
		return resp.data;
	}

	async getApplianceData(locationId, roomId, applianceId, dateFrom, dateTo, groupBy = 'day') {
		const url = `${this._applianceUrl(locationId, roomId, applianceId)}/data/aggregated`;
		const resp = await this.request({
			method: 'GET',
			url,
			params: { from: dateFrom, to: dateTo, groupBy },
		});
		return resp.data;
	}

	async getApplianceCommand(locationId, roomId, applianceId) {
		const url = `${this._applianceUrl(locationId, roomId, applianceId)}/command`;
		const resp = await this.request({ method: 'GET', url });
		return resp.data;
	}

	/**
	 * Send a command – GET current state, merge, POST back (like Python client).
	 *
	 * @param {string} locationId - The location ID
	 * @param {string} roomId - The room ID
	 * @param {string} applianceId - The appliance ID
	 * @param {object} commandFields - The command fields to merge
	 */
	async setApplianceCommand(locationId, roomId, applianceId, commandFields) {
		const url = `${this._applianceUrl(locationId, roomId, applianceId)}/command`;
		const current = await this.request({ method: 'GET', url });
		const merged = current.data || {};
		merged.command = { ...(merged.command || {}), ...commandFields };
		const resp = await this.request({ method: 'POST', url, data: merged });
		return resp.data;
	}

	async getApplianceStatus(locationId, roomId, applianceId) {
		const url = `${this._applianceUrl(locationId, roomId, applianceId)}/status`;
		const resp = await this.request({ method: 'GET', url });
		return resp.data;
	}

	async getApplianceNotifications(locationId, roomId, applianceId, pageSize = 10) {
		const url = `${this._applianceUrl(locationId, roomId, applianceId)}/notifications`;
		const resp = await this.request({ method: 'GET', url, params: { pageSize } });
		return resp.data;
	}

	async getAppliancePressureMeasurement(locationId, roomId, applianceId) {
		const url = `${this._applianceUrl(locationId, roomId, applianceId)}/pressuremeasurement`;
		const resp = await this.request({ method: 'GET', url });
		return resp.data;
	}

	/* ================================================================== */
	/*  Sense Guard – valve                                               */
	/* ================================================================== */

	async setValve(locationId, roomId, applianceId, open) {
		return this.setApplianceCommand(locationId, roomId, applianceId, { valve_open: open });
	}

	/* ================================================================== */
	/*  Sense Guard – pressure measurement                                */
	/* ================================================================== */

	async startPressureMeasurement(locationId, roomId, applianceId) {
		return this.setApplianceCommand(locationId, roomId, applianceId, { measure_now: true });
	}

	/* ================================================================== */
	/*  Sense Guard – snooze                                              */
	/* ================================================================== */

	async setSnooze(locationId, roomId, applianceId, duration) {
		return this.setApplianceCommand(locationId, roomId, applianceId, { snooze_duration: duration });
	}

	/* ================================================================== */
	/*  Blue – water dispensing                                           */
	/* ================================================================== */

	async tapWater(locationId, roomId, applianceId, tapType, amount) {
		return this.setApplianceCommand(locationId, roomId, applianceId, {
			tap_type: tapType,
			tap_amount: amount,
		});
	}

	async resetCo2(locationId, roomId, applianceId) {
		return this.setApplianceCommand(locationId, roomId, applianceId, { co2_status_reset: true });
	}

	async resetFilter(locationId, roomId, applianceId) {
		return this.setApplianceCommand(locationId, roomId, applianceId, { filter_status_reset: true });
	}

	/* ================================================================== */
	/*  Profile notifications                                             */
	/* ================================================================== */

	async getProfileNotifications(limit = 50) {
		const resp = await this.request({
			method: 'GET',
			url: `${BASE}/profile/notifications`,
			params: { pageSize: limit },
		});
		return resp.data;
	}
}

module.exports = GroheClient;

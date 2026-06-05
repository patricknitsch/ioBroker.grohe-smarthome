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
	 * @param {(callback: (...args: unknown[]) => void, ms: number) => unknown} [setTimeoutFn] - adapter-aware setTimeout function
	 */
	constructor(log, setTimeoutFn) {
		this.log = log;
		this.auth = new GroheAuth(log, setTimeoutFn);
		this.http = axios.create({ timeout: 15000 });
		this._useFallbackDiscovery = false;
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

	get usingFallbackDiscovery() {
		return this._useFallbackDiscovery;
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
			const status = err?.response?.status;
			if (status === 401 && retry) {
				this.log.debug('[client] 401 – refreshing token and retrying');
				await this.auth.refresh();
				return this.request(config, false);
			}
			if (status === 403) {
				this.log.warn(
					`[client] HTTP 403 (Forbidden) for ${config.url}. Please check if the Grohe app is working correctly and your account is still active.`,
				);
			}
			const body = err?.response?.data;
			if (body) {
				let serializedBody;
				try {
					serializedBody = JSON.stringify(body);
				} catch {
					serializedBody = '[unserializable response body]';
				}
				this.log.debug(`[client] HTTP ${status} response body for ${config.url}: ${serializedBody}`);
			}
			throw err;
		}
	}

	/* ================================================================== */
	/*  Dashboard (with fallback discovery)                               */
	/* ================================================================== */

	async getDashboard() {
		if (!this._useFallbackDiscovery) {
			try {
				const resp = await this.request({ method: 'GET', url: `${BASE}/dashboard` });
				return resp.data;
			} catch (err) {
				if (err?.response?.status === 404) {
					this.log.info('[client] /dashboard returned 404 – switching to fallback discovery');
					this._useFallbackDiscovery = true;
				} else {
					throw err;
				}
			}
		}
		return this._discoverViaFallback();
	}

	async _discoverViaFallback() {
		const locations = await this._getLocationsViaUser();
		const locationsResult = [];
		const result = { locations: locationsResult };
		for (const loc of locations) {
			const rooms = await this._getRooms(loc.id);
			const roomEntries = [];
			const locEntry = { id: loc.id, rooms: roomEntries };

			for (const room of rooms) {
				const appliances = await this._getAppliances(loc.id, room.id);
				const applianceEntries = [];
				const roomEntry = { id: room.id, appliances: applianceEntries };

				for (const app of appliances) {
					let details = {};
					let notifications = [];
					try {
						details = await this.getApplianceDetails(loc.id, room.id, app.appliance_id);
					} catch (err) {
						if (err?.response?.status === 404) {
							this.log.debug(`[client] Failed to get details for ${app.appliance_id}: ${err.message}`);
						} else {
							throw err;
						}
					}
					try {
						notifications = await this.getApplianceNotifications(loc.id, room.id, app.appliance_id, 1);
					} catch (err) {
						if (err?.response?.status === 404) {
							this.log.debug(
								`[client] Failed to get notifications for ${app.appliance_id}: ${err.message}`,
							);
						} else {
							throw err;
						}
					}
					roomEntry.appliances.push({
						...app,
						...(details || {}),
						notifications: Array.isArray(notifications) ? notifications : [],
					});
				}
				locEntry.rooms.push(roomEntry);
			}
			result.locations.push(locEntry);
		}
		return result;
	}

	_getUserIdFromToken() {
		const token = this.auth.accessToken;
		if (!token) {
			throw new Error('No access token available to extract user ID');
		}
		const parts = token.split('.');
		if (parts.length < 2) {
			throw new Error('Access token is not a valid JWT');
		}
		const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
		const userId = payload.sub;
		if (!userId) {
			throw new Error('JWT token does not contain a "sub" claim');
		}
		this.log.debug(`[client] Extracted user ID from JWT: ${userId}`);
		return userId;
	}

	async _getLocationsViaUser() {
		const userId = this._getUserIdFromToken();
		const resp = await this.request({ method: 'GET', url: `${BASE}/users/${userId}` });
		const userData = resp.data;
		this.log.debug(`[client] /users/${userId} response keys: ${Object.keys(userData || {}).join(', ')}`);

		if (Array.isArray(userData?.locations)) {
			this.log.info(`[client] Found ${userData.locations.length} location(s) via /users endpoint`);
			return userData.locations;
		}
		if (Array.isArray(userData)) {
			this.log.info(`[client] Found ${userData.length} location(s) via /users endpoint`);
			return userData;
		}
		throw new Error('Could not extract locations from /users endpoint');
	}

	async _getRooms(locationId) {
		const resp = await this.request({ method: 'GET', url: `${BASE}/locations/${locationId}/rooms` });
		return resp.data || [];
	}

	async _getAppliances(locationId, roomId) {
		const resp = await this.request({
			method: 'GET',
			url: `${BASE}/locations/${locationId}/rooms/${roomId}/appliances`,
		});
		return resp.data || [];
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
		if (merged.command.reason_for_change !== undefined) {
			merged.command.reason_for_change = Number(merged.command.reason_for_change) + 1;
		}
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
	/*  Sense Guard – appliance config (details endpoint)                */
	/* ================================================================== */

	async setApplianceConfig(locationId, roomId, applianceId, configFields) {
		const detailsUrl = `${this._applianceUrl(locationId, roomId, applianceId)}/details`;
		const current = await this.request({ method: 'GET', url: detailsUrl });
		const merged = current.data || {};
		merged.config = { ...(merged.config || {}), ...configFields };
		// Grohe API does not expose a writable /details endpoint.
		// Config updates go to the base appliance URL via PUT.
		const updateUrl = this._applianceUrl(locationId, roomId, applianceId);
		const resp = await this.request({ method: 'PUT', url: updateUrl, data: merged });
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
		const url = `${this._applianceUrl(locationId, roomId, applianceId)}/snooze`;
		const resp = await this.request({ method: 'PUT', url, data: { snooze_duration: duration } });
		return resp.data;
	}

	async deleteSnooze(locationId, roomId, applianceId) {
		const url = `${this._applianceUrl(locationId, roomId, applianceId)}/snooze`;
		const resp = await this.request({ method: 'DELETE', url });
		return resp.data;
	}

	async getSnooze(locationId, roomId, applianceId) {
		const url = `${this._applianceUrl(locationId, roomId, applianceId)}/snooze`;
		const resp = await this.request({ method: 'GET', url });
		return resp.data;
	}

	/* ================================================================== */
	/*  Blue – water dispensing                                           */
	/* ================================================================== */

	async tapWater(locationId, roomId, applianceId, tapType, amount) {
		const result = await this.setApplianceCommand(locationId, roomId, applianceId, {
			tap_type: tapType,
			tap_amount: amount,
		});
		// Reset tap fields to zero so that subsequent get_current_measurement commands
		// (which use the same read-modify-write pattern) do not re-trigger dispensing.
		try {
			await this.setApplianceCommand(locationId, roomId, applianceId, {
				tap_type: 0,
				tap_amount: 0,
			});
		} catch (err) {
			this.log.warn(`[client] Failed to reset tap command after dispense: ${err.message}`);
		}
		return result;
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

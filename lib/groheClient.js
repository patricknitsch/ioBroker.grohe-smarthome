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
		const result = { locations: [] };
		for (const loc of locations) {
			const rooms = await this._getRooms(loc.id);
			const locEntry = { id: loc.id, rooms: [] };

			for (const room of rooms) {
				const appliances = await this._getAppliances(loc.id, room.id);
				const roomEntry = { id: room.id, appliances: [] };

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
	/*  API structure dump (debug mode)                                   */
	/* ================================================================== */

	async dumpApiStructure() {
		const userId = this._getUserIdFromToken();
		const today = new Date().toISOString().split('T')[0];
		const yearAgo = new Date(Date.now() - 365 * 86400000).toISOString().split('T')[0];

		this.log.warn('=== API STRUCTURE DUMP START ===');

		// /users/{userId}
		await this._dumpEndpoint(`${BASE}/users/${userId}`);

		// /dashboard
		await this._dumpEndpoint(`${BASE}/dashboard`);

		// /locations
		const locations = await this._dumpEndpoint(`${BASE}/locations`);

		// /profile/notifications
		await this._dumpEndpoint(`${BASE}/profile/notifications?pageSize=5`);

		// Discover locations via /users if /locations failed
		let locationList = [];
		if (Array.isArray(locations)) {
			locationList = locations;
		} else {
			try {
				locationList = await this._getLocationsViaUser();
			} catch (err) {
				this.log.warn(`[dump] Could not get locations via /users: ${err.message}`);
			}
		}

		for (const loc of locationList) {
			const locId = loc.id;
			this.log.warn(`[dump] --- Location ${locId} ---`);

			// /locations/{id}
			await this._dumpEndpoint(`${BASE}/locations/${locId}`);

			// /locations/{id}/rooms
			const rooms = await this._dumpEndpoint(`${BASE}/locations/${locId}/rooms`);
			const roomList = Array.isArray(rooms) ? rooms : [];

			for (const room of roomList) {
				const roomId = room.id;
				this.log.warn(`[dump] --- Location ${locId} / Room ${roomId} ---`);

				// /locations/{id}/rooms/{id}
				await this._dumpEndpoint(`${BASE}/locations/${locId}/rooms/${roomId}`);

				// /locations/{id}/rooms/{id}/appliances
				const appliances = await this._dumpEndpoint(`${BASE}/locations/${locId}/rooms/${roomId}/appliances`);
				const appList = Array.isArray(appliances) ? appliances : [];

				for (const app of appList) {
					const appId = app.appliance_id;
					const appBase = `${BASE}/locations/${locId}/rooms/${roomId}/appliances/${appId}`;
					this.log.warn(`[dump] --- Appliance ${appId} (type=${app.type}, name=${app.name}) ---`);

					// /appliances/{id}
					await this._dumpEndpoint(appBase);
					// /appliances/{id}/details
					await this._dumpEndpoint(`${appBase}/details`);
					// /appliances/{id}/status
					await this._dumpEndpoint(`${appBase}/status`);
					// /appliances/{id}/command
					await this._dumpEndpoint(`${appBase}/command`);
					// /appliances/{id}/notifications
					await this._dumpEndpoint(`${appBase}/notifications?pageSize=10`);
					// /appliances/{id}/pressuremeasurement
					await this._dumpEndpoint(`${appBase}/pressuremeasurement`);
					// /appliances/{id}/data/aggregated (last year, grouped by month)
					await this._dumpEndpoint(`${appBase}/data/aggregated?from=${yearAgo}&to=${today}&groupBy=month`);
					// /appliances/{id}/data/aggregated (today, grouped by day)
					await this._dumpEndpoint(`${appBase}/data/aggregated?from=${today}&to=${today}&groupBy=day`);
				}
			}
		}

		this.log.warn('=== API STRUCTURE DUMP END ===');
	}

	async _dumpEndpoint(url) {
		try {
			const resp = await this.request({ method: 'GET', url });
			this.log.warn(`[dump] GET ${url} → ${resp.status}: ${JSON.stringify(resp.data)}`);
			return resp.data;
		} catch (err) {
			const status = err?.response?.status || 'N/A';
			const body = err?.response?.data;
			let bodyStr = '';
			if (body) {
				try {
					bodyStr = JSON.stringify(body);
				} catch {
					bodyStr = '[unserializable]';
				}
			}
			this.log.warn(`[dump] GET ${url} → ${status}: ${bodyStr || err.message}`);
			return null;
		}
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

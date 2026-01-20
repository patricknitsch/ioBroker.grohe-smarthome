/* eslint-disable jsdoc/require-jsdoc */
'use strict';

const axios = require('axios');

class GroheApi {
	/**
	 * @param {import('@iobroker/adapter-core').AdapterInstance} adapter
	 */
	constructor(adapter) {
		this.adapter = adapter;
		this.client = axios.create({
			timeout: 15000,
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		});

		/** @type {string|null} */
		this.accessToken = null;

		/** @type {string|null} */
		this.refreshToken = null;

		/** @type {string|null} */
		this.tokenEndpoint = null;

		/** @type {string|null} */
		this.clientId = null;
	}

	/**
	 * @param {string} token
	 */
	setRefreshToken(token) {
		// remove spaces/newlines from config copy/paste
		this.refreshToken = String(token || '').replace(/\s+/g, '');
		// derive token endpoint from JWT (iss)
		this._deriveEndpointsFromRefreshToken();
	}

	/**
	 * Decode JWT payload without verifying signature (only to read iss/azp)
	 */
	_deriveEndpointsFromRefreshToken() {
		try {
			if (!this.refreshToken) {
				return;
			}
			const parts = this.refreshToken.split('.');
			if (parts.length < 2) {
				return;
			}

			const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf8');
			const payload = JSON.parse(payloadJson);

			// issuer example: https://idp2-apigw.cloud.grohe.com/v1/sso/auth/realms/idm-apigw
			if (typeof payload.iss === 'string') {
				this.tokenEndpoint = `${payload.iss}/protocol/openid-connect/token`;
			}
			// authorized party / client id (in your token: "sense")
			if (typeof payload.azp === 'string') {
				this.clientId = payload.azp;
			} else {
				this.clientId = 'sense';
			}
		} catch (e) {
			// don't fail hard here, refresh() will throw a proper error if endpoint missing
			this.adapter.log.debug(`Konnte Token-Endpoint nicht aus JWT ableiten: ${e.message}`);
		}
	}

	/**
	 * Refresh access token using refresh_token (Keycloak)
	 * @returns {Promise<{accessToken: string, refreshToken: string}>}
	 */
	async refresh() {
		if (!this.refreshToken) {
			/** @type {Error & { code?: string }} */
			const err = new Error('Kein Refresh Token vorhanden');
			err.code = 'NO_REFRESH_TOKEN';
			throw err;
		}
		if (!this.tokenEndpoint) {
			/** @type {Error & { code?: string }} */
			const err = new Error('Token Endpoint konnte nicht bestimmt werden (iss fehlt?)');
			err.code = 'NO_TOKEN_ENDPOINT';
			throw err;
		}

		try {
			const body = new URLSearchParams({
				grant_type: 'refresh_token',
				refresh_token: this.refreshToken,
				client_id: this.clientId || 'sense',
			});

			const resp = await this.client.post(this.tokenEndpoint, body);

			if (!resp.data?.access_token) {
				/** @type {Error & { code?: string }} */
				const err = new Error('Keine access_token Antwort erhalten');
				err.code = 'TOKEN_RESPONSE_INVALID';
				throw err;
			}

			const accessToken = resp.data.access_token;
			const refreshToken = resp.data.refresh_token
				? String(resp.data.refresh_token).replace(/\s+/g, '')
				: this.refreshToken; // bleibt dann string

			this.accessToken = accessToken;
			this.refreshToken = refreshToken;

			return { accessToken, refreshToken };
		} catch (e) {
			const status = e?.response?.status;

			if (status === 400 || status === 401) {
				/** @type {Error & { code?: string }} */
				const err = new Error('Refresh Token ungültig/abgelaufen oder client_id falsch');
				err.code = 'INVALID_REFRESH_TOKEN';
				throw err;
			}

			/** @type {Error & { code?: string }} */
			const err = new Error(`Token Refresh fehlgeschlagen: ${e.message}`);
			err.code = 'TOKEN_REFRESH_FAILED';
			throw err;
		}
	}

	/**
	 * @param {import('axios').AxiosRequestConfig} config
	 * @param {boolean} [retry=true]
	 */
	async request(config, retry = true) {
		if (!this.accessToken) {
			await this.refresh();
		}

		config.headers = { ...(config.headers || {}), Authorization: `Bearer ${this.accessToken}` };

		try {
			return await this.client.request(config);
		} catch (e) {
			if (e?.response?.status === 401 && retry) {
				await this.refresh();
				return this.request(config, false);
			}
			throw e;
		}
	}
}

module.exports = GroheApi;

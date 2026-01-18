'use strict';

const { Issuer, generators } = require('openid-client');
const axios = require('axios');

/**
 *
 */
class GroheApi {
	/**
	 * @param {object} adapter - ioBroker Adapter instance
	 */
	constructor(adapter) {
		this.adapter = adapter;
		this.client = null; // openid-client client
		this.tokenSet = null; // Access + Refresh Token
	}

	/**
	 *
	 */
	async initClient() {
		this.adapter.log.info('OIDC Issuer wird entdeckt...');
		this.issuer = await Issuer.discover('https://idp2-apigw.cloud.grohe.com/v1/sso/auth/realms/idm-apigw');

		this.adapter.log.info(`Issuer: ${this.issuer.issuer}`);

		this.client = new this.issuer.Client({
			client_id: 'idm-apigw-client', // vom Reverse Engineering
			redirect_uris: ['http://localhost/callback'], // Dummy, da kein Browser
			response_types: ['code'],
		});
	}

	/**
	 * Starte den Authorization Code Flow mit PKCE.
	 * Liefert dir die URL, die du im Browser öffnen musst.
	 */
	async generateAuthUrl(email) {
		if (!this.client) {
			await this.initClient();
		}

		this.codeVerifier = generators.codeVerifier();
		this.codeChallenge = generators.codeChallenge(this.codeVerifier);

		const authUrl = this.client.authorizationUrl({
			scope: 'openid offline_access',
			resource: 'ondus',
			code_challenge: this.codeChallenge,
			code_challenge_method: 'S256',
			login_hint: email,
		});

		this.adapter.log.info(`Authorization URL generiert. Bitte im Browser öffnen: ${authUrl}`);

		return authUrl;
	}

	/**
	 * Tausche den Authorization Code (aus Redirect-URL) gegen Tokens.
	 * @param {string} code Authorization Code aus Redirect URL
	 */
	async exchangeCodeForToken(code) {
		if (!this.client) {
			await this.initClient();
		}

		this.tokenSet = await this.client.callback(
			'http://localhost/callback',
			{ code },
			{ code_verifier: this.codeVerifier },
		);

		this.adapter.log.info('Access Token erhalten.');
	}

	/**
	 * Erneuere das Access Token
	 */
	async refresh() {
		if (!this.tokenSet?.refresh_token) {
			throw new Error('Kein Refresh Token verfügbar.');
		}
		this.adapter.log.info('Erneuere Access Token mit Refresh Token...');

		this.tokenSet = await this.client.refresh(this.tokenSet.refresh_token);

		this.adapter.log.info('Access Token erneuert.');
	}

	/**
	 * HTTP Request mit automatischer Token-Refresh-Logik
	 */
	async request(config, retry = true) {
		if (!this.tokenSet) {
			throw new Error('Nicht authentifiziert, bitte Authorization Code tauschen.');
		}

		config.headers = config.headers || {};
		config.headers.Authorization = `Bearer ${this.tokenSet.access_token}`;

		try {
			return await axios.request(config);
		} catch (err) {
			if (err.response?.status === 401 && retry) {
				this.adapter.log.info('Access Token abgelaufen, versuche Refresh');
				await this.refresh();
				return this.request(config, false);
			}
			throw err;
		}
	}
}

module.exports = GroheApi;

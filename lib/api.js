'use strict';

const axios = require('axios');

class GroheApi {
	constructor(adapter) {
		this.adapter = adapter;
		this.client = axios.create({ timeout: 15000 });
		this.accessToken = null;
		this.refreshToken = null;
	}

	async login(email, password) {
		this.adapter.log.info('Einmaliger Grohe Login…');

		const resp = await this.client.post('https://idp2-apigw.cloud.grohe.com/v3/iot/oidc/login', {
			email,
			password,
		});

		if (!resp.data?.refresh_token) {
			throw new Error('Kein Refresh Token erhalten');
		}

		this.refreshToken = resp.data.refresh_token;
		this.accessToken = resp.data.access_token;

		this.adapter.log.info('Login erfolgreich – Token erhalten');
	}

	async refresh() {
		if (!this.refreshToken) {
			throw new Error('Kein Refresh Token vorhanden');
		}

		const resp = await this.client.post('https://idp2-apigw.cloud.grohe.com/v3/iot/oidc/token', {
			grant_type: 'refresh_token',
			refresh_token: this.refreshToken,
		});

		this.accessToken = resp.data.access_token;

		if (resp.data.refresh_token) {
			this.refreshToken = resp.data.refresh_token;
		}
	}

	async request(config, retry = true) {
		if (!this.accessToken) {
			await this.refresh();
		}

		config.headers = config.headers || {};
		config.headers.Authorization = `Bearer ${this.accessToken}`;

		try {
			return await this.client.request(config);
		} catch (err) {
			if (err.response?.status === 401 && retry) {
				await this.refresh();
				return this.request(config, false);
			}
			throw err;
		}
	}
}

module.exports = GroheApi;

'use strict';

/**
 * Grohe OAuth authentication module.
 *
 * Implements the same login flow as the groheblue Python library (tokens.py):
 *   1. GET  /v3/iot/oidc/login  (follow redirects) -> Keycloak HTML form
 *   2. Parse <form action="…"> from HTML
 *   3. POST username + password to form action (no follow redirects)
 *   4. Read 302 Location header starting with "ondus://"
 *   5. Replace ondus:// with https://, GET that URL -> JSON tokens
 *   6. Refresh via POST /v3/iot/oidc/refresh
 *
 * Uses axios-cookiejar-support + tough-cookie so that Keycloak session cookies
 * are automatically maintained across the redirect chain (just like Python
 * httpx.AsyncClient does by default).
 */

const axios = require('axios');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');
const cheerio = require('cheerio');

const AUTH_BASE_URL = 'https://idp2-apigw.cloud.grohe.com/v3/iot/oidc/login';
const REFRESH_URL = 'https://idp2-apigw.cloud.grohe.com/v3/iot/oidc/refresh';

class GroheAuth {
	/**
	 * @param {object} log  – adapter.log compatible logger
	 */
	constructor(log) {
		this.log = log;

		this.accessToken = null;
		this.refreshToken = null;
		/** expiresAt – unix-ms when the access token expires */
		this.expiresAt = 0;
	}

	/* ------------------------------------------------------------------ */
	/*  Create a cookie-aware axios client for login                      */
	/* ------------------------------------------------------------------ */
	_createLoginClient() {
		const jar = new CookieJar();
		const client = wrapper(
			axios.create({
				timeout: 25000,
				withCredentials: true,
			}),
		);
		/** @type {any} */
		const c = client;
		c.defaults.jar = jar;
		return client;
	}

	/* ------------------------------------------------------------------ */
	/*  Full login with username + password                               */
	/* ------------------------------------------------------------------ */

	/**
	 * @param {string} email
	 * @param {string} password
	 */
	async login(email, password) {
		if (!email || !password) {
			throw new Error('E-Mail und Passwort sind erforderlich');
		}

		// Use a cookie-aware client for the entire login flow
		const client = this._createLoginClient();

		// Step 1 – GET login page (follow redirects to Keycloak)
		this.log.debug('[auth] GET login page (follow redirects)');
		const loginPage = await client.get(AUTH_BASE_URL, {
			maxRedirects: 10,
			headers: { Accept: 'text/html' },
		});

		if (typeof loginPage.data !== 'string') {
			throw new Error('Login-Seite lieferte kein HTML');
		}

		// Step 2 – parse form action
		const $ = cheerio.load(loginPage.data);
		const form = $('form').first();
		const actionRaw = form.attr('action');
		if (!actionRaw) {
			throw new Error('Login-Form action nicht gefunden');
		}
		const baseUrl = loginPage.request?.res?.responseUrl || AUTH_BASE_URL;
		const actionUrl = new URL(actionRaw, baseUrl).toString();
		this.log.debug(`[auth] form action -> ${actionUrl.split('?')[0]}`);

		// Step 3 – POST credentials (do NOT follow redirects)
		this.log.debug('[auth] POST credentials');
		let postResp;
		try {
			postResp = await client.post(actionUrl, new URLSearchParams({ username: email, password }).toString(), {
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
					Referer: baseUrl,
				},
				maxRedirects: 0,
				validateStatus: s => s >= 200 && s < 400,
			});
		} catch (err) {
			// axios throws on 3xx when maxRedirects=0 – use the response from the error
			if (err.response && err.response.status >= 300 && err.response.status < 400) {
				postResp = err.response;
			} else {
				throw err;
			}
		}

		const location = postResp.headers.location || '';
		this.log.debug(`[auth] POST status=${postResp.status} location=${location.substring(0, 60)}…`);

		if (!location.startsWith('ondus://')) {
			// Could be another redirect in the Keycloak chain – follow manually
			if (location && (postResp.status === 302 || postResp.status === 303)) {
				return this._followRedirects(client, location, actionUrl);
			}
			// Check for error in HTML response
			if (postResp.status === 200 && typeof postResp.data === 'string') {
				if (postResp.data.includes('Invalid username or password')) {
					throw new Error('Ungültige Zugangsdaten (Benutzername oder Passwort falsch).');
				}
			}
			throw new Error(
				`Login fehlgeschlagen – unerwarteter Redirect: ${location.substring(0, 100) || `status ${postResp.status}`}`,
			);
		}

		// Step 4+5 – exchange ondus:// callback for tokens
		return this._exchangeOndusUrl(location);
	}

	/* ------------------------------------------------------------------ */
	/*  Follow additional redirects until we hit ondus://                  */
	/* ------------------------------------------------------------------ */
	async _followRedirects(client, url, baseUrl) {
		let currentUrl = url.startsWith('http') ? url : new URL(url, baseUrl).toString();
		for (let i = 0; i < 15; i++) {
			this.log.debug(`[auth] follow redirect -> ${currentUrl.split('?')[0]}`);
			let resp;
			try {
				resp = await client.get(currentUrl, {
					maxRedirects: 0,
					validateStatus: s => s >= 200 && s < 400,
					headers: { Accept: 'text/html,application/json' },
				});
			} catch (err) {
				if (err.response && err.response.status >= 300 && err.response.status < 400) {
					resp = err.response;
				} else {
					throw err;
				}
			}
			const loc = resp.headers.location || '';
			if (loc.startsWith('ondus://')) {
				return this._exchangeOndusUrl(loc);
			}
			if (loc && (resp.status === 301 || resp.status === 302 || resp.status === 303)) {
				currentUrl = loc.startsWith('http') ? loc : new URL(loc, currentUrl).toString();
				continue;
			}
			throw new Error(`Login fehlgeschlagen in Redirect-Kette (status ${resp.status})`);
		}
		throw new Error('Login fehlgeschlagen – zu viele Redirects');
	}

	/* ------------------------------------------------------------------ */
	/*  Exchange ondus:// URL for tokens                                  */
	/* ------------------------------------------------------------------ */
	async _exchangeOndusUrl(ondusUrl) {
		const httpsUrl = ondusUrl.replace(/^ondus:\/\//, 'https://');
		this.log.debug('[auth] GET token URL');

		const resp = await axios.get(httpsUrl, {
			headers: { Accept: 'application/json' },
		});

		if (!resp.data?.access_token || !resp.data?.refresh_token) {
			throw new Error('Token-Antwort enthält kein access_token/refresh_token');
		}

		this._applyTokens(resp.data);
		this.log.info('[auth] Login erfolgreich – Tokens erhalten');
		return {
			access_token: this.accessToken,
			refresh_token: this.refreshToken,
			expires_in: resp.data.expires_in,
		};
	}

	/* ------------------------------------------------------------------ */
	/*  Refresh tokens                                                    */
	/* ------------------------------------------------------------------ */
	async refresh() {
		if (!this.refreshToken) {
			throw new Error('Kein Refresh-Token vorhanden');
		}

		this.log.debug('[auth] refreshing tokens');
		const resp = await axios.post(
			REFRESH_URL,
			{ refresh_token: this.refreshToken },
			{ headers: { 'Content-Type': 'application/json' } },
		);

		if (!resp.data?.access_token) {
			throw new Error('Token-Refresh lieferte kein access_token');
		}

		this._applyTokens(resp.data);
		this.log.debug('[auth] token refresh ok');
		return {
			access_token: this.accessToken,
			refresh_token: this.refreshToken,
		};
	}

	/* ------------------------------------------------------------------ */
	/*  Get a valid access token (auto-refresh if expired)                */
	/* ------------------------------------------------------------------ */
	async getAccessToken() {
		if (!this.accessToken) {
			throw new Error('Nicht eingeloggt – bitte zuerst login() aufrufen');
		}
		if (Date.now() >= this.expiresAt) {
			await this.refresh();
		}
		return this.accessToken;
	}

	/* ------------------------------------------------------------------ */
	/*  Internal helpers                                                  */
	/* ------------------------------------------------------------------ */
	_applyTokens(data) {
		this.accessToken = data.access_token;
		if (data.refresh_token) {
			this.refreshToken = data.refresh_token;
		}
		const expiresIn = data.expires_in || 3600;
		// subtract 60 s safety margin
		this.expiresAt = Date.now() + (expiresIn - 60) * 1000;
	}
}

module.exports = GroheAuth;

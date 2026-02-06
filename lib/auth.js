'use strict';

/**
 * Grohe OAuth authentication module.
 *
 * Implements the same login flow as koproductions-code/grohe (tokens.py):
 *   1. GET  /v3/iot/oidc/login  (follow redirects) -> Keycloak HTML form
 *   2. Parse <form action="…"> from HTML
 *   3. POST username + password to form action (NO follow redirects)
 *   4. Catch the 302 response, read Location header starting with "ondus://"
 *   5. Replace ondus:// with https://, GET that URL -> JSON tokens
 *   6. Refresh via POST /v3/iot/oidc/refresh
 *
 * Uses axios-cookiejar-support + tough-cookie so that Keycloak session cookies
 * are maintained across the redirect chain (like Python httpx.AsyncClient).
 */

const axios = require('axios');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');
const cheerio = require('cheerio');

const BASE_URL = 'https://idp2-apigw.cloud.grohe.com/v3/iot';
const LOGIN_URL = `${BASE_URL}/oidc/login`;
const REFRESH_URL = `${BASE_URL}/oidc/refresh`;

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
				timeout: 30000,
				withCredentials: true,
			}),
		);
		/** @type {any} */
		const c = client;
		c.defaults.jar = jar;
		return client;
	}

	/* ------------------------------------------------------------------ */
	/*  Full login with username + password (with retry)                  */
	/* ------------------------------------------------------------------ */

	/**
	 * @param {string} email
	 * @param {string} password
	 */
	async login(email, password) {
		if (!email || !password) {
			throw new Error('E-Mail und Passwort sind erforderlich');
		}

		// Retry up to 3 times (fresh cookie jar each attempt, like the old login.js)
		let lastError;
		for (let attempt = 1; attempt <= 3; attempt++) {
			try {
				this.log.debug(`[auth] login attempt ${attempt}/3`);
				return await this._doLogin(email, password);
			} catch (err) {
				lastError = err;
				this.log.warn(`[auth] attempt ${attempt} failed: ${err.message}`);
				if (attempt < 3) {
					// Wait before retry (exponential backoff)
					await new Promise(r => setTimeout(r, attempt * 2000));
				}
			}
		}
		throw lastError;
	}

	async _doLogin(email, password) {
		// Fresh cookie-aware client for each attempt
		const client = this._createLoginClient();

		// Step 1 – GET login page (follow redirects to Keycloak)
		this.log.debug('[auth] step 1: GET login page');
		const loginPage = await client.get(LOGIN_URL, {
			maxRedirects: 10,
			headers: {
				Accept: 'text/html,application/xhtml+xml',
				'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36',
			},
		});

		if (typeof loginPage.data !== 'string') {
			throw new Error('Login-Seite lieferte kein HTML');
		}

		// Detect known errors in the HTML
		this._checkHtmlErrors(loginPage.data);

		// Step 2 – parse form action URL
		const $ = cheerio.load(loginPage.data);
		const form = $('form').first();
		const actionRaw = form.attr('action');
		if (!actionRaw) {
			throw new Error('Login-Form action nicht gefunden im HTML');
		}

		// Resolve relative action URL against the final URL after redirects
		const finalUrl = loginPage.request?.res?.responseUrl || LOGIN_URL;
		const actionUrl = new URL(actionRaw.replace(/&amp;/g, '&'), finalUrl).toString();
		this.log.debug(`[auth] step 2: form action -> ${actionUrl.split('?')[0]}`);

		// Step 3 – POST credentials
		// Key: Do NOT use validateStatus. Let axios throw on 302 (like Python httpx does).
		// The 302 contains the ondus:// redirect in the Location header.
		this.log.debug('[auth] step 3: POST credentials');

		const postData = new URLSearchParams({ username: email, password }).toString();

		let location;
		try {
			const resp = await client.post(actionUrl, postData, {
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
					Referer: finalUrl,
					Accept: 'text/html,application/xhtml+xml',
				},
				maxRedirects: 0, // stop at the 302
			});

			// If we get 200 back, Keycloak showed us the login page again (wrong creds / CSRF)
			if (resp.status === 200 && typeof resp.data === 'string') {
				this._checkHtmlErrors(resp.data);
				throw new Error('Login fehlgeschlagen – Keycloak zeigte Login-Seite erneut');
			}

			location = resp.headers?.location || '';
		} catch (err) {
			// axios throws on 3xx when maxRedirects=0 – this is expected for 302
			if (err.response && err.response.status >= 300 && err.response.status < 400) {
				location = err.response.headers?.location || '';
			} else if (err.response && err.response.status === 200) {
				// Got HTML back instead of redirect
				if (typeof err.response.data === 'string') {
					this._checkHtmlErrors(err.response.data);
				}
				throw new Error('Login fehlgeschlagen – Keycloak zeigte Login-Seite erneut');
			} else {
				throw err;
			}
		}

		this.log.debug(`[auth] POST result: location=${(location || '').substring(0, 60)}…`);

		// Step 4 – follow redirects until we get ondus://
		if (location.startsWith('ondus://')) {
			return this._exchangeOndusUrl(location);
		}

		// Maybe we need to follow more redirects in the Keycloak chain
		if (location) {
			return this._followRedirects(client, location, actionUrl);
		}

		throw new Error('Login fehlgeschlagen – kein Redirect nach Credential-POST erhalten');
	}

	/* ------------------------------------------------------------------ */
	/*  Follow additional redirects until we hit ondus://                  */
	/* ------------------------------------------------------------------ */
	async _followRedirects(client, url, baseUrl) {
		let currentUrl = url.startsWith('http') ? url : new URL(url, baseUrl).toString();
		for (let i = 0; i < 15; i++) {
			this.log.debug(`[auth] follow redirect ${i + 1} -> ${currentUrl.split('?')[0]}`);

			let loc;
			try {
				const resp = await client.get(currentUrl, {
					maxRedirects: 0,
					headers: { Accept: 'text/html,application/json' },
				});
				// 200 = no more redirects, check for ondus:// in response
				loc = resp.headers?.location || '';
			} catch (err) {
				if (err.response && err.response.status >= 300 && err.response.status < 400) {
					loc = err.response.headers?.location || '';
				} else {
					throw err;
				}
			}

			if (loc.startsWith('ondus://')) {
				return this._exchangeOndusUrl(loc);
			}
			if (loc) {
				currentUrl = loc.startsWith('http') ? loc : new URL(loc, currentUrl).toString();
				continue;
			}
			throw new Error(`Login fehlgeschlagen in Redirect-Kette (Schritt ${i + 1})`);
		}
		throw new Error('Login fehlgeschlagen – zu viele Redirects');
	}

	/* ------------------------------------------------------------------ */
	/*  Exchange ondus:// URL for tokens                                  */
	/* ------------------------------------------------------------------ */
	async _exchangeOndusUrl(ondusUrl) {
		const httpsUrl = ondusUrl.replace(/^ondus:\/\//, 'https://');
		this.log.debug('[auth] step 5: exchanging code for tokens');

		const resp = await axios.get(httpsUrl, {
			headers: { Accept: 'application/json' },
			timeout: 15000,
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
			{
				headers: { 'Content-Type': 'application/json' },
				timeout: 15000,
			},
		);

		if (!resp.data?.access_token) {
			throw new Error('Token-Refresh lieferte kein access_token');
		}

		this._applyTokens(resp.data);
		this.log.debug('[auth] token refresh erfolgreich');
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
	/*  HTML error detection                                              */
	/* ------------------------------------------------------------------ */
	_checkHtmlErrors(html) {
		if (!html) {
			return;
		}
		if (html.includes('Invalid username or password')) {
			throw new Error('Ungültige Zugangsdaten (Benutzername oder Passwort falsch)');
		}
		if (html.includes('Restart login cookie not found')) {
			throw new Error('Keycloak Session abgelaufen (Restart cookie not found) – bitte erneut versuchen');
		}
		if (html.includes("We're sorry")) {
			throw new Error('Keycloak Fehlerseite – Server-Problem bei Grohe');
		}
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
		// subtract 60 s safety margin (same as Python grohe client)
		this.expiresAt = Date.now() + (expiresIn - 60) * 1000;
	}
}

module.exports = GroheAuth;

'use strict';

/**
 * Grohe OAuth authentication module.
 *
 * Mirrors koproductions-code/grohe tokens.py EXACTLY:
 *   1. GET  /v3/iot/oidc/login  – manually follow EVERY redirect, collecting
 *      Set-Cookie headers at each hop (like httpx.AsyncClient does automatically)
 *   2. Parse <form action="..."> from Keycloak HTML
 *   3. POST {username, password} to action URL with accumulated cookies
 *   4. Catch the 302 response, read Location header with "ondus://"
 *   5. Replace ondus:// with https://, GET -> JSON tokens
 *   6. Refresh via POST /v3/iot/oidc/refresh
 */

const axios = require('axios');
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

		let lastError;
		for (let attempt = 1; attempt <= 3; attempt++) {
			try {
				this.log.debug(`[auth] login attempt ${attempt}/3`);
				return await this._doLogin(email, password);
			} catch (err) {
				lastError = err;
				this.log.warn(`[auth] attempt ${attempt} failed: ${err.message}`);
				if (attempt < 3) {
					await new Promise(r => setTimeout(r, attempt * 2000));
				}
			}
		}
		throw lastError;
	}

	/* ------------------------------------------------------------------ */
	/*  Core login – mirrors Python tokens.py exactly                     */
	/* ------------------------------------------------------------------ */
	async _doLogin(email, password) {
		// ── Step 1 ──────────────────────────────────────────────────────
		// GET login page by MANUALLY following every redirect.
		// At each hop we collect Set-Cookie headers so we build a full
		// cookie jar – exactly what Python httpx.AsyncClient does.
		// ────────────────────────────────────────────────────────────────
		this.log.debug('[auth] step 1: GET login page (manual redirect chain)');

		const { body: html, cookies, finalUrl } = await this._getWithCookies(LOGIN_URL);

		if (typeof html !== 'string' || html.length === 0) {
			throw new Error('Login-Seite lieferte kein HTML');
		}
		this._checkHtmlErrors(html);

		const cookieNames = Object.keys(cookies);
		this.log.debug(`[auth] collected ${cookieNames.length} cookie(s): [${cookieNames.join(', ')}]`);
		this.log.debug(`[auth] final URL after redirects: ${finalUrl}`);

		// ── Step 2 ──────────────────────────────────────────────────────
		// Parse form action URL – mirrors Python:
		//   action_url = urllib.parse.urljoin(LOGIN_URL, form['action'])
		// IMPORTANT: base is LOGIN_URL, not finalUrl!
		// ────────────────────────────────────────────────────────────────
		const $ = cheerio.load(html);
		const form = $('form').first();
		const actionRaw = form.attr('action');
		if (!actionRaw) {
			this.log.error('[auth] HTML had no <form> with action. HTML snippet: ' + html.substring(0, 500));
			throw new Error('Login-Form action nicht gefunden im HTML');
		}

		// Python: urllib.parse.urljoin(f'{self.__api_url}/oidc/login', form['action'])
		// Uses LOGIN_URL as base, NOT the final Keycloak URL after redirects
		const actionUrl = new URL(actionRaw.replace(/&amp;/g, '&'), LOGIN_URL).toString();

		this.log.debug(`[auth] step 2: raw action = ${actionRaw.substring(0, 120)}`);
		this.log.debug(`[auth] step 2: resolved action URL = ${actionUrl.split('?')[0]}`);

		// ── Step 3 ──────────────────────────────────────────────────────
		// POST credentials – mirrors Python EXACTLY:
		//   payload = {'username': email, 'password': password}
		//   headers = {'Content-Type': ..., 'Referer': LOGIN_URL}
		// Python sends ONLY username+password, NOT hidden form fields.
		// Python uses LOGIN_URL as Referer, NOT finalUrl.
		// ────────────────────────────────────────────────────────────────
		this.log.debug('[auth] step 3: POST credentials');
		const cookieHeader = this._cookiesToHeader(cookies);

		const payload = new URLSearchParams({
			username: email,
			password: password,
		}).toString();

		let location;
		try {
			const resp = await axios.post(actionUrl, payload, {
				timeout: 30000,
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
					Referer: LOGIN_URL,
					Cookie: cookieHeader,
				},
				maxRedirects: 0,
				validateStatus: () => true,
			});

			this.log.debug(`[auth] POST status: ${resp.status}`);

			if (resp.status === 200 && typeof resp.data === 'string') {
				this._checkHtmlErrors(resp.data);
				this.log.debug('[auth] POST returned 200 HTML (first 500 chars): ' + resp.data.substring(0, 500));
				throw new Error('Login fehlgeschlagen – Keycloak zeigte Login-Seite erneut (status 200)');
			}

			location = resp.headers?.location || '';
			this.log.debug(`[auth] POST location: ${(location || 'NONE').substring(0, 120)}`);
		} catch (err) {
			if (err.response && err.response.status >= 300 && err.response.status < 400) {
				location = err.response.headers?.location || '';
				this.log.debug(`[auth] caught redirect ${err.response.status} -> ${(location || '').substring(0, 120)}`);
			} else if (err.message && err.message.includes('Login fehlgeschlagen')) {
				throw err;
			} else if (err.message && err.message.includes('Ungültige Zugangsdaten')) {
				throw err;
			} else if (err.response) {
				this.log.error(`[auth] POST returned unexpected status ${err.response.status}`);
				if (typeof err.response.data === 'string') {
					this._checkHtmlErrors(err.response.data);
					this.log.debug('[auth] response body: ' + err.response.data.substring(0, 500));
				}
				throw err;
			} else {
				throw err;
			}
		}

		// ── Step 4 ──────────────────────────────────────────────────────
		// Handle redirect(s) – Python:
		//   location = exc.response.headers.get('Location')
		//   tokens_url = location.replace('ondus://', 'https://')
		// ────────────────────────────────────────────────────────────────
		if (location.startsWith('ondus://')) {
			return this._exchangeOndusUrl(location);
		}
		if (location) {
			return this._followRedirects(location, actionUrl, cookies);
		}

		throw new Error('Login fehlgeschlagen – kein Redirect nach Credential-POST erhalten');
	}

	/* ------------------------------------------------------------------ */
	/*  GET with manual redirect following + cookie accumulation          */
	/* ------------------------------------------------------------------ */

	/**
	 * Performs a GET request following redirects manually, accumulating
	 * Set-Cookie headers from EVERY hop.
	 *
	 * @param {string} startUrl
	 * @returns {Promise<{body: string, cookies: Object<string,string>, finalUrl: string}>}
	 */
	async _getWithCookies(startUrl) {
		const cookies = {}; // name -> "name=value"
		let currentUrl = startUrl;

		for (let i = 0; i < 20; i++) {
			this.log.debug(`[auth] redirect hop ${i}: GET ${currentUrl}`);

			const resp = await axios.get(currentUrl, {
				maxRedirects: 0,
				timeout: 30000,
				validateStatus: () => true,
				headers: {
					Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
					Cookie: this._cookiesToHeader(cookies),
				},
			});

			// Accumulate cookies from this response
			this._collectCookies(resp, cookies);

			const newCookies = resp.headers?.['set-cookie'];
			if (newCookies) {
				const names = (Array.isArray(newCookies) ? newCookies : [newCookies])
					.map(sc => sc.split('=')[0]);
				this.log.debug(`[auth]   hop ${i} set cookies: [${names.join(', ')}]`);
			}

			if (resp.status >= 300 && resp.status < 400 && resp.headers?.location) {
				const loc = resp.headers.location;
				this.log.debug(`[auth]   hop ${i} -> ${resp.status} redirect to ${loc.substring(0, 120)}`);
				// Resolve relative URLs
				currentUrl = loc.startsWith('http') ? loc : new URL(loc, currentUrl).toString();
				continue;
			}

			this.log.debug(`[auth]   hop ${i} -> ${resp.status} (final page, ${typeof resp.data === 'string' ? resp.data.length : 0} bytes)`);
			// Non-redirect response – we've arrived at the final page
			return {
				body: typeof resp.data === 'string' ? resp.data : '',
				cookies,
				finalUrl: currentUrl,
			};
		}
		throw new Error('Login fehlgeschlagen – zu viele Redirects beim Laden der Login-Seite');
	}

	/* ------------------------------------------------------------------ */
	/*  Collect Set-Cookie headers into our cookie map                    */
	/* ------------------------------------------------------------------ */

	/**
	 * Extract Set-Cookie values from a response and merge into cookies map.
	 */
	_collectCookies(resp, cookies) {
		const setCookieHeaders = resp.headers?.['set-cookie'];
		if (!setCookieHeaders) {
			return;
		}

		const headers = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
		for (const sc of headers) {
			const pair = sc.split(';')[0].trim();
			const eqIdx = pair.indexOf('=');
			if (eqIdx > 0) {
				const name = pair.substring(0, eqIdx);
				cookies[name] = pair;
			}
		}
	}

	/**
	 * Build a Cookie header string from our cookies map.
	 */
	_cookiesToHeader(cookies) {
		return Object.values(cookies).join('; ');
	}

	/* ------------------------------------------------------------------ */
	/*  Follow additional redirects until we hit ondus://                  */
	/* ------------------------------------------------------------------ */
	async _followRedirects(url, baseUrl, cookies) {
		let currentUrl = url.startsWith('http') ? url : new URL(url, baseUrl).toString();
		const cookieHeader = this._cookiesToHeader(cookies || {});

		for (let i = 0; i < 15; i++) {
			this.log.debug(`[auth] follow redirect ${i + 1} -> ${currentUrl.substring(0, 120)}`);

			const resp = await axios.get(currentUrl, {
				maxRedirects: 0,
				timeout: 15000,
				validateStatus: () => true,
				headers: {
					Accept: 'text/html,application/json',
					Cookie: cookieHeader,
				},
			});

			const loc = resp.headers?.location || '';

			if (loc.startsWith('ondus://')) {
				return this._exchangeOndusUrl(loc);
			}
			if (loc && resp.status >= 300 && resp.status < 400) {
				currentUrl = loc.startsWith('http') ? loc : new URL(loc, currentUrl).toString();
				continue;
			}
			this.log.debug(`[auth] redirect chain stopped at status ${resp.status}`);
			if (typeof resp.data === 'string') {
				this.log.debug('[auth] response: ' + resp.data.substring(0, 300));
			}
			throw new Error(`Login fehlgeschlagen in Redirect-Kette (Schritt ${i + 1}, status ${resp.status})`);
		}
		throw new Error('Login fehlgeschlagen – zu viele Redirects');
	}

	/* ------------------------------------------------------------------ */
	/*  Exchange ondus:// URL for tokens                                  */
	/* ------------------------------------------------------------------ */
	async _exchangeOndusUrl(ondusUrl) {
		// Python: tokens_url = location.replace('ondus://', 'https://')
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
		// Python: json={'refresh_token': ..., 'grant_type': 'refresh_token'}
		const resp = await axios.post(
			REFRESH_URL,
			{ refresh_token: this.refreshToken, grant_type: 'refresh_token' },
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
			throw new Error('Keycloak Session abgelaufen (Restart cookie not found)');
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

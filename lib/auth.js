/* eslint-disable jsdoc/require-jsdoc */
'use strict';

/**
 * Grohe OAuth authentication module.
 *
 * Mirrors koproductions-code/grohe tokens.py:
 *   1. GET  /v3/iot/oidc/login  – follow redirects manually, accumulating
 *      cookies via tough-cookie CookieJar (domain/path aware, like httpx)
 *   2. Parse <form action="..."> from Keycloak HTML
 *   3. POST {username, password} to action URL (jar provides cookies)
 *   4. Catch the 302 → ondus:// location
 *   5. Exchange ondus:// URL for JSON tokens
 *   6. Refresh via POST /v3/iot/oidc/refresh
 */

const axios = require('axios');
const cheerio = require('cheerio');
const tough = require('tough-cookie');

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
	/*  Token masking helper                                              */
	/* ------------------------------------------------------------------ */

	_maskToken(token) {
		if (!token || typeof token !== 'string') {
			return '***';
		}
		if (token.length < 12) {
			return '***';
		}
		return `${token.substring(0, 6)}...${token.substring(token.length - 4)}`;
	}

	/* ------------------------------------------------------------------ */
	/*  Full login with username + password (with retry)                  */
	/* ------------------------------------------------------------------ */

	/**
	 * @param {string} email – user email address
	 * @param {string} password – user password
	 */
	async login(email, password) {
		if (!email || !password) {
			throw new Error('Email and password are required');
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
	/*  Core login – mirrors Python tokens.py                             */
	/* ------------------------------------------------------------------ */
	async _doLogin(email, password) {
		// Fresh cookie jar per login attempt (like HA integration's cookies.clear())
		const jar = new tough.CookieJar();

		// ── Step 1 ──────────────────────────────────────────────────────
		// GET login page, manually follow redirects, jar collects cookies
		// at each hop with proper domain/path handling (like httpx).
		// ────────────────────────────────────────────────────────────────
		this.log.debug('[auth] step 1: GET login page (manual redirect chain)');

		const { body: html, finalUrl } = await this._getWithJar(LOGIN_URL, jar);

		if (typeof html !== 'string' || html.length === 0) {
			throw new Error('Login page returned no HTML');
		}
		this._checkHtmlErrors(html);

		const jarCookies = jar.getCookieStringSync(finalUrl);
		this.log.debug(`[auth] jar cookies for ${new URL(finalUrl).hostname}: ${jarCookies.substring(0, 200)}`);

		// ── Step 2 ──────────────────────────────────────────────────────
		// Parse form action URL – Python: urljoin(LOGIN_URL, form['action'])
		// ────────────────────────────────────────────────────────────────
		const $ = cheerio.load(html);
		const form = $('form').first();
		const actionRaw = form.attr('action');
		if (!actionRaw) {
			this.log.error(`[auth] no <form action> in HTML: ${html.substring(0, 500)}`);
			throw new Error('Login form action not found in HTML');
		}

		// Use LOGIN_URL as base for urljoin (like Python)
		const actionUrl = new URL(actionRaw.replace(/&amp;/g, '&'), LOGIN_URL).toString();

		this.log.debug(`[auth] step 2: action URL = ${actionUrl}`);

		// ── Step 3 ──────────────────────────────────────────────────────
		// POST {username, password} – exactly like Python:
		//   payload = {'username': email, 'password': password}
		//   headers = {'Content-Type': ..., 'Referer': LOGIN_URL}
		// ────────────────────────────────────────────────────────────────
		this.log.debug('[auth] step 3: POST credentials');

		// Get cookies that the jar would send to the action URL
		const cookieHeader = jar.getCookieStringSync(actionUrl);
		this.log.debug(`[auth] cookies for POST: ${cookieHeader.substring(0, 200)}`);

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

			// Store any new cookies from the POST response
			this._storeCookiesFromResponse(resp, actionUrl, jar);

			this.log.debug(`[auth] POST status: ${resp.status}`);

			if (resp.status === 200 && typeof resp.data === 'string') {
				this._checkHtmlErrors(resp.data);
				this._logKeycloakError(resp.data);
				throw new Error('Login failed – Keycloak returned login page again (status 200)');
			}

			location = resp.headers?.location || '';
			this.log.debug(`[auth] POST location: ${(location || 'NONE').substring(0, 200)}`);
		} catch (err) {
			if (err.response && err.response.status >= 300 && err.response.status < 400) {
				location = err.response.headers?.location || '';
				this.log.debug(
					`[auth] caught redirect ${err.response.status} -> ${(location || '').substring(0, 200)}`,
				);
			} else if (err.message && (err.message.includes('Login failed') || err.message.includes('Invalid'))) {
				throw err;
			} else if (err.response) {
				this.log.error(`[auth] POST status ${err.response.status}`);
				throw err;
			} else {
				throw err;
			}
		}

		// ── Step 4 ──────────────────────────────────────────────────────
		// Follow redirect(s) to ondus:// → exchange for tokens
		// ────────────────────────────────────────────────────────────────
		if (location.startsWith('ondus://')) {
			return this._exchangeOndusUrl(location);
		}
		if (location) {
			return this._followRedirects(location, actionUrl, jar);
		}

		throw new Error('Login failed – no redirect received after credential POST');
	}

	/* ------------------------------------------------------------------ */
	/*  GET with manual redirect following + tough-cookie jar             */
	/* ------------------------------------------------------------------ */

	/**
	 * GET a URL, follow redirects manually, storing all cookies in the jar.
	 *
	 * @param {string} startUrl – the initial URL to fetch
	 * @param {tough.CookieJar} jar – cookie jar for storing and sending cookies
	 * @returns {Promise<{body: string, finalUrl: string}>} Promise resolving to object with HTML body and final URL after redirects
	 */
	async _getWithJar(startUrl, jar) {
		let currentUrl = startUrl;

		for (let i = 0; i < 20; i++) {
			// Get cookies that the jar would send to this URL
			const cookieHeader = jar.getCookieStringSync(currentUrl);

			this.log.debug(`[auth] hop ${i}: GET ${currentUrl.substring(0, 200)}`);
			if (cookieHeader) {
				this.log.debug(`[auth]   sending cookies: ${cookieHeader.substring(0, 150)}`);
			}

			const resp = await axios.get(currentUrl, {
				maxRedirects: 0,
				timeout: 30000,
				validateStatus: () => true,
				headers: {
					Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
					Cookie: cookieHeader || undefined,
				},
			});

			// Store cookies from this response in the jar
			this._storeCookiesFromResponse(resp, currentUrl, jar);

			if (resp.status >= 300 && resp.status < 400 && resp.headers?.location) {
				const loc = resp.headers.location;
				currentUrl = loc.startsWith('http') ? loc : new URL(loc, currentUrl).toString();
				this.log.debug(`[auth]   hop ${i} -> ${resp.status} redirect`);
				continue;
			}

			this.log.debug(
				`[auth]   hop ${i} -> ${resp.status} final (${typeof resp.data === 'string' ? resp.data.length : 0} bytes)`,
			);
			return {
				body: typeof resp.data === 'string' ? resp.data : '',
				finalUrl: currentUrl,
			};
		}
		throw new Error('Too many redirects while loading login page');
	}

	/* ------------------------------------------------------------------ */
	/*  Store Set-Cookie headers in the tough-cookie jar                  */
	/* ------------------------------------------------------------------ */

	/**
	 * Extract Set-Cookie headers from response and store in jar.
	 *
	 * @param {import('axios').AxiosResponse} resp – axios response object
	 * @param {string} requestUrl – the URL of the request that generated the response
	 * @param {tough.CookieJar} jar – cookie jar to store extracted cookies
	 */
	_storeCookiesFromResponse(resp, requestUrl, jar) {
		const setCookieHeaders = resp.headers?.['set-cookie'];
		if (!setCookieHeaders) {
			return;
		}

		const headers = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
		for (const sc of headers) {
			try {
				jar.setCookieSync(sc, requestUrl, { ignoreError: true });
			} catch (_e) {
				// Ignore invalid cookies
				this.log.warn(`[auth] failed to store cookie from header: ${_e.message}`);
			}
		}

		const names = headers.map(sc => sc.split('=')[0]);
		this.log.debug(`[auth]   stored cookies: [${names.join(', ')}]`);
	}

	/* ------------------------------------------------------------------ */
	/*  Follow additional redirects until we hit ondus://                  */
	/* ------------------------------------------------------------------ */
	async _followRedirects(url, baseUrl, jar) {
		let currentUrl = url.startsWith('http') ? url : new URL(url, baseUrl).toString();

		for (let i = 0; i < 15; i++) {
			const cookieHeader = jar.getCookieStringSync(currentUrl);
			this.log.debug(`[auth] follow redirect ${i + 1} -> ${currentUrl.substring(0, 200)}`);

			const resp = await axios.get(currentUrl, {
				maxRedirects: 0,
				timeout: 15000,
				validateStatus: () => true,
				headers: {
					Accept: 'text/html,application/json',
					Cookie: cookieHeader || undefined,
				},
			});

			this._storeCookiesFromResponse(resp, currentUrl, jar);
			const loc = resp.headers?.location || '';

			if (loc.startsWith('ondus://')) {
				return this._exchangeOndusUrl(loc);
			}
			if (loc && resp.status >= 300 && resp.status < 400) {
				currentUrl = loc.startsWith('http') ? loc : new URL(loc, currentUrl).toString();
				continue;
			}
			this.log.debug(`[auth] redirect stopped at status ${resp.status}`);
			throw new Error(`Login failed in redirect chain (status ${resp.status})`);
		}
		throw new Error('Too many redirects after login');
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
			throw new Error('Token response missing access_token/refresh_token');
		}

		this._applyTokens(resp.data);
		this.log.info('[auth] Login successful – tokens received');
		this.log.debug(`[auth] access token: ${this._maskToken(this.accessToken)}`);
		this.log.debug(`[auth] refresh token: ${this._maskToken(this.refreshToken)}`);
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
			throw new Error('No refresh token available');
		}

		this.log.debug('[auth] refreshing tokens');
		const resp = await axios.post(
			REFRESH_URL,
			{ refresh_token: this.refreshToken, grant_type: 'refresh_token' },
			{
				headers: { 'Content-Type': 'application/json' },
				timeout: 15000,
			},
		);

		if (!resp.data?.access_token) {
			throw new Error('Token refresh returned no access_token');
		}

		this._applyTokens(resp.data);
		this.log.debug(`[auth] token refresh successful (access: ${this._maskToken(this.accessToken)})`);
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
			throw new Error('Not logged in – call login() first');
		}
		if (Date.now() >= this.expiresAt) {
			await this.refresh();
		}
		return this.accessToken;
	}

	/* ------------------------------------------------------------------ */
	/*  HTML error detection + logging                                    */
	/* ------------------------------------------------------------------ */
	_checkHtmlErrors(html) {
		if (!html) {
			return;
		}
		if (html.includes('Invalid username or password') || html.includes('Invalid email address or password')) {
			throw new Error('Invalid credentials (email or password wrong)');
		}
		if (html.includes('Restart login cookie not found')) {
			throw new Error('Keycloak session expired (Restart cookie not found)');
		}
		if (html.includes("We're sorry")) {
			throw new Error('Keycloak error page – server problem at Grohe');
		}
	}

	/**
	 * Parse the Keycloak HTML response and log any error/alert messages found.
	 *
	 * @param {string} html – the HTML response to parse for error messages
	 */
	_logKeycloakError(html) {
		try {
			const $ = cheerio.load(html);
			// Check various Keycloak error containers
			const errorText =
				$('.alert-error').text().trim() ||
				$('.kc-feedback-text').text().trim() ||
				$('#kc-content-wrapper .instruction').text().trim() ||
				$('.pf-m-error').text().trim() ||
				$('[class*="error"]').first().text().trim();
			if (errorText) {
				this.log.warn(`[auth] Keycloak error: ${errorText}`);
			}

			// Log all form fields for debugging
			const form = $('form').first();
			if (form.length) {
				const fields = [];
				form.find('input').each((_i, el) => {
					const name = $(el).attr('name');
					const type = $(el).attr('type') || 'text';
					if (name) {
						fields.push(`${name}(${type})`);
					}
				});
				this.log.debug(`[auth] form fields in response: [${fields.join(', ')}]`);
			}
		} catch (_e) {
			// Ignore parsing errors
			this.log.warn(`[auth] failed to parse Keycloak error from HTML: ${_e.message}`);
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
		this.expiresAt = Date.now() + (expiresIn - 60) * 1000;
	}
}

module.exports = GroheAuth;

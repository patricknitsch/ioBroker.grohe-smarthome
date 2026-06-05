'use strict';

const { expect } = require('chai');
const GroheAuth = require('./auth');

describe('GroheAuth', () => {
	it('uses the injected setTimeout implementation for login retries', async () => {
		const timeouts = [];
		const auth = new GroheAuth(
			{ debug: () => {}, warn: () => {} },
			(callback, ms) => {
				timeouts.push(ms);
				callback();
			},
		);

		let attempt = 0;
		auth._doLogin = async () => {
			attempt++;
			if (attempt < 3) {
				throw new Error(`attempt ${attempt} failed`);
			}
			return { access_token: 'ok', refresh_token: 'refresh', expires_in: 3600 };
		};

		const result = await auth.login('user@example.com', 'secret');

		expect(result).to.deep.equal({ access_token: 'ok', refresh_token: 'refresh', expires_in: 3600 });
		expect(timeouts).to.deep.equal([2000, 4000]);
	});
});

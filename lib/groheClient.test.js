'use strict';

const { expect } = require('chai');
const GroheClient = require('./groheClient');

describe('GroheClient', () => {
	describe('tapWater', () => {
		it('resets tap_type and tap_amount to 0 after dispatching the dispense command', async () => {
			const commandHistory = [];
			const client = new GroheClient({ debug: () => {}, warn: () => {}, info: () => {}, error: () => {} });

			// Track every setApplianceCommand call
			client.setApplianceCommand = async (locId, roomId, appId, fields) => {
				commandHistory.push({ ...fields });
			};

			await client.tapWater('loc1', 'room1', 'app1', 1, 250);

			// First call: actual dispense
			expect(commandHistory[0]).to.deep.equal({ tap_type: 1, tap_amount: 250 });

			// Second call: reset to prevent re-dispensing on next measurement refresh
			expect(commandHistory[1]).to.deep.equal({ tap_type: 0, tap_amount: 0 });

			expect(commandHistory.length).to.equal(2);
		});

		it('still returns the result of the dispense command even if reset fails', async () => {
			const warnings = [];
			const client = new GroheClient({
				debug: () => {},
				warn: msg => warnings.push(msg),
				info: () => {},
				error: () => {},
			});

			let callCount = 0;
			client.setApplianceCommand = async (locId, roomId, appId, fields) => {
				callCount++;
				if (callCount === 2) {
					throw new Error('network error');
				}
				return { command: { tap_type: fields.tap_type, tap_amount: fields.tap_amount } };
			};

			// Should not throw even when reset fails
			const result = await client.tapWater('loc1', 'room1', 'app1', 2, 500);

			expect(result).to.deep.equal({ command: { tap_type: 2, tap_amount: 500 } });
			expect(callCount).to.equal(2);
			expect(warnings).to.have.length(1);
			expect(warnings[0]).to.include('Failed to reset tap command after dispense');
			expect(warnings[0]).to.include('network error');
		});
	});

	describe('setApplianceConfig', () => {
		it('sends only the changed config keys via PUT to the appliance URL', async () => {
			const requests = [];
			const client = new GroheClient({ debug: () => {}, warn: () => {}, info: () => {}, error: () => {} });
			client.request = async opts => {
				requests.push(opts);
				return { data: { config: { withdrawel_amount_limit: 500 } } };
			};

			const result = await client.setApplianceConfig('loc1', 'room1', 'app1', { withdrawel_amount_limit: 500 });

			expect(requests).to.have.length(1);
			expect(requests[0].method).to.equal('PUT');
			expect(requests[0].url).to.match(/\/locations\/loc1\/rooms\/room1\/appliances\/app1$/);
			expect(requests[0].data).to.deep.equal({ config: { withdrawel_amount_limit: 500 } });
			expect(result).to.deep.equal({ config: { withdrawel_amount_limit: 500 } });
		});

		it('returns undefined when the API answers without a body', async () => {
			const client = new GroheClient({ debug: () => {}, warn: () => {}, info: () => {}, error: () => {} });
			client.request = async () => ({ data: '' });

			const result = await client.setApplianceConfig('loc1', 'room1', 'app1', {
				sprinkler_mode_active_monday: true,
			});

			expect(result).to.equal(undefined);
		});
	});

	describe('renewTokens', () => {
		const log = { debug: () => {}, warn: () => {}, info: () => {}, error: () => {} };
		const httpError = status => Object.assign(new Error(`HTTP ${status}`), { response: { status } });

		function createClient(refreshImpl) {
			const client = new GroheClient(log);
			client.auth.accessToken = 'old-access';
			client.auth.refreshToken = 'old-refresh';
			client.auth.expiresAt = Date.now() + 3600000;
			client.auth.refresh = refreshImpl;
			return client;
		}

		it('logs in again when the refresh token is rejected', async () => {
			let logins = 0;
			const renewed = [];
			const client = createClient(async () => {
				throw httpError(401);
			});
			client.reloginHandler = async () => {
				logins++;
				client.auth.refreshToken = 'new-refresh';
			};
			client.onTokensRenewed = async token => renewed.push(token);

			await client.renewTokens();

			expect(logins).to.equal(1);
			expect(renewed).to.deep.equal(['new-refresh']);
		});

		it('does not log in again on network errors, 429 or server errors', async () => {
			for (const err of [new Error('ECONNRESET'), httpError(429), httpError(503)]) {
				let logins = 0;
				const client = createClient(async () => {
					throw err;
				});
				client.reloginHandler = async () => {
					logins++;
				};

				let thrown;
				try {
					await client.renewTokens();
				} catch (e) {
					thrown = e;
				}

				expect(thrown).to.equal(err);
				expect(logins).to.equal(0);
			}
		});

		it('shares one renewal between concurrent callers', async () => {
			let refreshes = 0;
			const client = createClient(async () => {
				refreshes++;
				await new Promise(resolve => setTimeout(resolve, 10));
			});

			await Promise.all([client.renewTokens(), client.renewTokens(), client.renewTokens()]);

			expect(refreshes).to.equal(1);
		});

		it('retries a request once with the renewed token after a 401', async () => {
			const tokensUsed = [];
			const client = createClient(async () => {
				client.auth.accessToken = 'new-access';
			});
			client.http = {
				request: async config => {
					tokensUsed.push(config.headers.Authorization);
					if (tokensUsed.length === 1) {
						throw httpError(401);
					}
					return { data: 'ok' };
				},
			};

			const resp = await client.request({ method: 'GET', url: 'x' });

			expect(resp.data).to.equal('ok');
			expect(tokensUsed).to.deep.equal(['Bearer old-access', 'Bearer new-access']);
		});
	});
});

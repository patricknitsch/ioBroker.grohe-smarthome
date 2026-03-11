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
				warn: (msg) => warnings.push(msg),
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
});

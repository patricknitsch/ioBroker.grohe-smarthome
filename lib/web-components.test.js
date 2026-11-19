'use strict';

const { expect } = require('chai');
const { getDeviceOptions } = require('./web-components');

describe('web-components: getDeviceOptions', () => {
	it('lists the appliances of the instance with their type, sorted', async () => {
		const adapter = {
			namespace: 'grohe-smarthome.0',
			getDevicesAsync: async () => [
				{ _id: 'grohe-smarthome.0.guard1', common: { name: 'Keller (Sense Guard)' }, native: { type: 'SENSE_GUARD' } },
				{ _id: 'grohe-smarthome.0.blue1', common: { name: { en: 'Kitchen', de: 'Küche' } }, native: { type: 'BLUE_HOME' } },
				{ _id: 'grohe-smarthome.0.sense1', common: { name: '' }, native: { type: 'SENSE' } },
				{ _id: 'grohe-smarthome.0.guard1.controls', common: { name: 'nested' }, native: {} },
				{ _id: 'grohe-smarthome.1.other', common: { name: 'other instance' }, native: {} },
			],
		};
		const options = await getDeviceOptions(/** @type {any} */ (adapter));
		expect(options).to.deep.equal([
			{ value: 'grohe-smarthome.0.guard1', label: 'Keller (Sense Guard)' },
			{ value: 'grohe-smarthome.0.blue1', label: 'Kitchen (Blue Home)' },
			{ value: 'grohe-smarthome.0.sense1', label: 'sense1 (Sense)' },
		]);
	});

	it('returns an empty list without appliances', async () => {
		const adapter = { namespace: 'grohe-smarthome.0', getDevicesAsync: async () => [] };
		expect(await getDeviceOptions(/** @type {any} */ (adapter))).to.deep.equal([]);
	});
});

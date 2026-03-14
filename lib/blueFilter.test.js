'use strict';

/**
 * Tests for Grohe Blue remaining filter percentage calculation.
 *
 * The Grohe app calculates: Math.round(remaining_filter_liters / filter_capacity * 100)
 * The raw API field `remaining_filter` uses a legacy 3000 L base and diverges from the app.
 *
 * Reference: ha-grohe_smarthome config.yaml → details.params.filter_type
 */

const { expect } = require('chai');

// Mirror the constants from main.js (kept in sync)
const BLUE_FILTER_CAPACITY_LITERS = {
	1: 1500, // S_SIZE
	2: 1500, // ACTIVE_CARBON
	3: 1500, // ULTRA_SAFE
	4: 1500, // MAGNESIUM_PLUS
	5: 3150, // M_SIZE (most common for Blue Home)
};
const BLUE_FILTER_CAPACITY_DEFAULT = 3150;

/**
 * Mirrors the calculation in _updateBlueStates (main.js).
 */
function calcRemainingFilterPct(remainingFilterLiters, filterType) {
	const filterCapacity =
		filterType != null
			? (BLUE_FILTER_CAPACITY_LITERS[filterType] ?? BLUE_FILTER_CAPACITY_DEFAULT)
			: BLUE_FILTER_CAPACITY_DEFAULT;
	return remainingFilterLiters != null
		? Math.min(100, Math.max(0, Math.round((remainingFilterLiters / filterCapacity) * 100)))
		: null;
}

describe('Blue filter percentage calculation', () => {
	it('reproduces the Grohe app value for M_SIZE filter (type 5)', () => {
		// From real device log: remaining_filter=66, remaining_filter_liters=1966, app shows 62%
		const pct = calcRemainingFilterPct(1966, 5);
		expect(pct).to.equal(62);
	});

	it('uses M_SIZE capacity as default when filter_type is null', () => {
		// With no filter type known, default to M_SIZE (3150 L)
		const pct = calcRemainingFilterPct(1966, null);
		expect(pct).to.equal(62);
	});

	it('uses M_SIZE capacity as default for an unknown filter_type value', () => {
		// Type 99 is not in the map → falls back to BLUE_FILTER_CAPACITY_DEFAULT
		const pct = calcRemainingFilterPct(1575, 99);
		expect(pct).to.equal(50);
	});

	it('uses the correct capacity for S_SIZE filter (type 1)', () => {
		const pct = calcRemainingFilterPct(750, 1);
		expect(pct).to.equal(50);
	});

	it('clamps the result to 100 when liters exceed capacity', () => {
		// Freshly installed filter may briefly report slightly above capacity
		const pct = calcRemainingFilterPct(3500, 5);
		expect(pct).to.equal(100);
	});

	it('clamps the result to 0 when liters are 0', () => {
		const pct = calcRemainingFilterPct(0, 5);
		expect(pct).to.equal(0);
	});

	it('returns null when remaining_filter_liters is null (no liters data)', () => {
		// Falls back to raw remaining_filter handled by caller
		const pct = calcRemainingFilterPct(null, 5);
		expect(pct).to.be.null;
	});

	it('correctly rounds to nearest integer', () => {
		// 1000 / 3150 = 31.746… → rounds to 32
		const pct = calcRemainingFilterPct(1000, 5);
		expect(pct).to.equal(32);
	});
});

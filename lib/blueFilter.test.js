'use strict';

/**
 * Tests for Grohe Blue remaining filter percentage calculation.
 *
 * The Grohe app calculates: Math.round(remaining_filter_liters / filter_capacity * 100)
 * The raw API field `remaining_filter` may diverge from the app.
 *
 * Filter capacities (from Grohe product specifications):
 *   1 = S Filter          →   600 L
 *   2 = Aktivkohlefilter  → 3000 L
 *   3 = Ultra Safe Filter → 3000 L
 *   4 = Magnesium+Zink    →  400 L
 *   5 = M Filter          → 1500 L
 *   6 = L Filter          → 2500 L
 */

const { expect } = require('chai');

// Mirror the constants from main.js (kept in sync)
const BLUE_FILTER_CAPACITY_LITERS = {
	1: 600, // S_SIZE
	2: 3000, // ACTIVE_CARBON (Aktivkohlefilter)
	3: 3000, // ULTRA_SAFE
	4: 400, // MAGNESIUM_PLUS (Magnesium+Zink)
	5: 1500, // M_SIZE
	6: 2500, // L_SIZE
};
const BLUE_FILTER_CAPACITY_DEFAULT = 3000;

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
	it('uses correct capacity for ACTIVE_CARBON / Aktivkohlefilter (type 2, 3000 L)', () => {
		expect(calcRemainingFilterPct(1500, 2)).to.equal(50);
		expect(calcRemainingFilterPct(3000, 2)).to.equal(100);
		expect(calcRemainingFilterPct(0, 2)).to.equal(0);
	});

	it('uses correct capacity for ULTRA_SAFE (type 3, 3000 L)', () => {
		expect(calcRemainingFilterPct(1500, 3)).to.equal(50);
	});

	it('uses correct capacity for M_SIZE / M Filter (type 5, 1500 L)', () => {
		expect(calcRemainingFilterPct(750, 5)).to.equal(50);
		expect(calcRemainingFilterPct(1500, 5)).to.equal(100);
	});

	it('uses correct capacity for S_SIZE / S Filter (type 1, 600 L)', () => {
		expect(calcRemainingFilterPct(300, 1)).to.equal(50);
		expect(calcRemainingFilterPct(600, 1)).to.equal(100);
	});

	it('uses correct capacity for MAGNESIUM_PLUS / Magnesium+Zink (type 4, 400 L)', () => {
		expect(calcRemainingFilterPct(200, 4)).to.equal(50);
		expect(calcRemainingFilterPct(400, 4)).to.equal(100);
	});

	it('uses correct capacity for L_SIZE / L Filter (type 6, 2500 L)', () => {
		expect(calcRemainingFilterPct(1250, 6)).to.equal(50);
		expect(calcRemainingFilterPct(2500, 6)).to.equal(100);
	});

	it('uses ACTIVE_CARBON (3000 L) as default when filter_type is null', () => {
		expect(calcRemainingFilterPct(1500, null)).to.equal(50);
		expect(calcRemainingFilterPct(3000, null)).to.equal(100);
	});

	it('uses default capacity for an unknown filter_type value', () => {
		// Type 99 is not in the map → falls back to BLUE_FILTER_CAPACITY_DEFAULT (3000 L)
		expect(calcRemainingFilterPct(1500, 99)).to.equal(50);
	});

	it('clamps the result to 100 when liters exceed capacity', () => {
		expect(calcRemainingFilterPct(4000, 2)).to.equal(100);
		expect(calcRemainingFilterPct(700, 1)).to.equal(100);
	});

	it('clamps the result to 0 when liters are 0', () => {
		expect(calcRemainingFilterPct(0, 5)).to.equal(0);
	});

	it('returns null when remaining_filter_liters is null (no liters data)', () => {
		// Falls back to raw remaining_filter handled by caller
		expect(calcRemainingFilterPct(null, 2)).to.be.null;
		expect(calcRemainingFilterPct(null, null)).to.be.null;
	});

	it('correctly rounds to nearest integer', () => {
		// 1000 / 3000 = 33.33… → rounds to 33
		expect(calcRemainingFilterPct(1000, 2)).to.equal(33);
		// 100 / 600 = 16.67… → rounds to 17
		expect(calcRemainingFilterPct(100, 1)).to.equal(17);
	});
});

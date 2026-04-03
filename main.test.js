'use strict';

const { expect } = require('chai');

/**
 * Standalone copy of GroheSmarthome._calcFilterPct for unit testing.
 * Keep in sync with main.js implementation.
 */
function calcFilterPct(apiPct, dateOfFilterReplacement) {
	if (typeof apiPct !== 'number' || !dateOfFilterReplacement) {
		return apiPct;
	}
	const replacementDate = new Date(dateOfFilterReplacement);
	if (isNaN(replacementDate.getTime())) {
		return apiPct;
	}
	const daysSince = (Date.now() - replacementDate.getTime()) / (1000 * 60 * 60 * 24);
	const timeBasedPct = Math.max(0, 100 - (daysSince / 360) * 100);
	return Math.min(apiPct, timeBasedPct);
}

describe('_calcFilterPct (remaining filter correction)', () => {
	it('returns the API value unchanged when no replacement date is given', () => {
		expect(calcFilterPct(77, undefined)).to.equal(77);
		expect(calcFilterPct(77, null)).to.equal(77);
		expect(calcFilterPct(77, '')).to.equal(77);
	});

	it('returns undefined when apiPct is undefined (no measurement data)', () => {
		expect(calcFilterPct(undefined, '2025-07-16T11:23:00.000+02:00')).to.equal(undefined);
	});

	it('returns the API value unchanged when the replacement date is invalid', () => {
		expect(calcFilterPct(77, 'not-a-date')).to.equal(77);
	});

	it('uses the time-based value when it is lower than the API value', () => {
		// ~256 days ago → timeBasedPct ≈ 28.9  < 77  → should return ≈ 28.9
		const replacementDate = new Date(Date.now() - 256 * 24 * 60 * 60 * 1000).toISOString();
		const result = calcFilterPct(77, replacementDate);
		expect(result).to.be.approximately(28.9, 0.5);
	});

	it('uses the API value when it is lower than the time-based value (recently replaced filter)', () => {
		// 10 days ago → timeBasedPct ≈ 97.2  > 30  → should return 30
		const replacementDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
		const result = calcFilterPct(30, replacementDate);
		expect(result).to.equal(30);
	});

	it('clamps the time-based value to 0 when the filter is older than 360 days', () => {
		const replacementDate = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
		const result = calcFilterPct(5, replacementDate);
		expect(result).to.equal(0);
	});

	it('returns 0 when the API value is 0', () => {
		const replacementDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
		expect(calcFilterPct(0, replacementDate)).to.equal(0);
	});
});

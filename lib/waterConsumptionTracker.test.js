'use strict';

const { expect } = require('chai');
const { WaterConsumptionTracker, groupByFor } = require('./waterConsumptionTracker');

const log = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

/**
 * @param {object} opts - options
 * @param {string} opts.today - today as YYYY-MM-DD
 * @param {object | null} [opts.stored] - stored state
 * @param {(start: string, end: string, groupBy: string) => number} [opts.fetchTotal] - fake API
 */
function createTracker({ today, stored = null, fetchTotal }) {
	const ctx = { today, stored, saves: [], calls: [] };
	ctx.tracker = new WaterConsumptionTracker({
		applianceId: 'app1',
		log,
		today: () => ctx.today,
		load: async () => ctx.stored,
		save: async data => {
			ctx.stored = JSON.parse(JSON.stringify(data));
			ctx.saves.push(ctx.stored);
		},
		fetchTotal: async (start, end, groupBy) => {
			ctx.calls.push([start, end, groupBy]);
			return fetchTotal ? fetchTotal(start, end, groupBy) : 10;
		},
	});
	return ctx;
}

describe('WaterConsumptionTracker', () => {
	it('uses groupBy year only for whole calendar years', () => {
		expect(groupByFor('2023-01-01', '2024-12-31')).to.equal('year');
		expect(groupByFor('2023-03-15', '2023-12-31')).to.equal('day');
		expect(groupByFor('2025-01-01', '2025-09-30')).to.equal('day');
	});

	it('fetches the history in calendar-year chunks and then the current month', async () => {
		const ctx = createTracker({ today: '2025-10-25' });

		await ctx.tracker.sync('2023-06-15');

		expect(ctx.calls).to.deep.equal([
			['2023-06-15', '2023-12-31', 'day'],
			['2024-01-01', '2024-12-31', 'year'],
			['2025-01-01', '2025-09-30', 'day'],
			['2025-10-01', '2025-10-24', 'day'],
		]);
		expect(ctx.tracker.totalUntil('2025-10-24')).to.equal(40);
		expect(ctx.tracker.totalUntil('2025-10-25')).to.equal(null);
		expect(ctx.stored).to.deep.equal({
			baseTotal: 30,
			baseUntil: '2025-09-30',
			months: { '2025-10': 10 },
			syncedUntil: '2025-10-24',
		});
	});

	it('does not fetch again on the same day', async () => {
		const ctx = createTracker({ today: '2025-10-25' });
		await ctx.tracker.sync('2025-01-01');
		const calls = ctx.calls.length;

		await ctx.tracker.sync('2025-01-01');

		expect(ctx.calls.length).to.equal(calls);
	});

	it('continues from the stored state after a restart and only fetches recent months', async () => {
		const ctx = createTracker({
			today: '2025-11-02',
			stored: {
				baseTotal: 1000,
				baseUntil: '2025-09-30',
				months: { '2025-10': 50 },
				syncedUntil: '2025-10-24',
			},
			fetchTotal: start => (start.startsWith('2025-10') ? 60 : 5),
		});

		await ctx.tracker.sync('2020-01-01');

		// October is fetched again (overwritten, not added), November up to yesterday
		expect(ctx.calls).to.deep.equal([
			['2025-10-01', '2025-10-31', 'day'],
			['2025-11-01', '2025-11-01', 'day'],
		]);
		expect(ctx.tracker.totalUntil('2025-11-01')).to.equal(1065);
	});

	it('folds months before the previous one into the base total', async () => {
		const ctx = createTracker({
			today: '2025-12-05',
			stored: {
				baseTotal: 1000,
				baseUntil: '2025-09-30',
				months: { '2025-10': 50 },
				syncedUntil: '2025-10-31',
			},
		});

		await ctx.tracker.sync('2020-01-01');

		// October is fetched once more (late uploads), then folded into the base
		expect(ctx.calls.map(c => c[0])).to.deep.equal(['2025-10-01', '2025-11-01', '2025-12-01']);
		expect(ctx.stored).to.deep.equal({
			baseTotal: 1010,
			baseUntil: '2025-10-31',
			months: { '2025-11': 10, '2025-12': 10 },
			syncedUntil: '2025-12-04',
		});
	});

	it('keeps the progress of the chunks fetched before an error', async () => {
		let fail = true;
		const ctx = createTracker({
			today: '2025-10-25',
			fetchTotal: start => {
				if (start === '2024-01-01' && fail) {
					throw new Error('timeout');
				}
				return 10;
			},
		});

		let thrown;
		try {
			await ctx.tracker.sync('2023-06-15');
		} catch (err) {
			thrown = err;
		}
		expect(thrown?.message).to.equal('timeout');
		expect(ctx.tracker.totalUntil('2025-10-24')).to.equal(null);
		expect(ctx.stored).to.deep.include({ baseTotal: 10, baseUntil: '2023-12-31', syncedUntil: null });

		fail = false;
		ctx.calls.length = 0;
		await ctx.tracker.sync('2023-06-15');

		expect(ctx.calls[0]).to.deep.equal(['2024-01-01', '2024-12-31', 'year']);
		expect(ctx.tracker.totalUntil('2025-10-24')).to.equal(40);
	});

	it('handles a device installed in the current month', async () => {
		const ctx = createTracker({ today: '2025-10-25' });

		await ctx.tracker.sync('2025-10-10');

		// Same as HA: the current month is queried from its first day
		expect(ctx.calls).to.deep.equal([['2025-10-01', '2025-10-24', 'day']]);
		expect(ctx.tracker.totalUntil('2025-10-24')).to.equal(10);
	});

	it('fetches everything again when the stored state is invalid', async () => {
		const ctx = createTracker({ today: '2025-10-25', stored: { baseTotal: 'x' } });

		await ctx.tracker.sync('2025-01-01');

		expect(ctx.calls[0]).to.deep.equal(['2025-01-01', '2025-09-30', 'day']);
		expect(ctx.tracker.totalUntil('2025-10-24')).to.equal(20);
	});
});

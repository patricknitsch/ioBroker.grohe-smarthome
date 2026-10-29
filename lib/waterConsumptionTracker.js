/* eslint-disable jsdoc/require-jsdoc */
'use strict';

/**
 * Persist the lifetime water consumption of a Sense Guard and keep it current with deltas.
 *
 * Port of WaterConsumptionTracker from ha-grohe_smarthome (v0.4.0).
 *
 * The only way to get the lifetime total from Grohe is /data/aggregated, and a query
 * from the installation date to now gets slower the older the device is (9-60 s, with
 * occasional gateway timeouts). Instead of asking for the whole history again every day,
 * the history is fetched once – in calendar-year chunks so a single timeout only costs
 * one chunk – and stored. After that, only the current and the previous month are
 * queried, once a day.
 *
 * Grohe returns whole buckets of the requested grouping and ignores `from`/`to` inside
 * them: groupBy=year for Jan 1 – Sep 30 returns the whole year so far, groupBy=month for
 * Oct 1 – Oct 24 the whole month including today. groupBy=month is also a few hundred
 * liters short per year compared to day and year. So whole calendar years are queried
 * with `year` and everything else with `day` (see groupByFor).
 *
 * Counting starts at the device's installation_date.
 *
 * Stored state (all dates as YYYY-MM-DD):
 *   baseTotal    sum of all full days up to and including baseUntil
 *   baseUntil    last day covered by baseTotal (always the last day of a month)
 *   months       {"YYYY-MM": total} for the months after baseUntil
 *   syncedUntil  last full day covered by baseTotal + months; null until the
 *                historical fetch is complete
 */

/* ------------------------------------------------------------------ */
/*  Date helpers – plain YYYY-MM-DD strings, calculated in UTC so DST  */
/*  never shifts a day                                                 */
/* ------------------------------------------------------------------ */

function parseDay(str) {
	const [y, m, d] = str.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d));
}

function formatDay(date) {
	return date.toISOString().substring(0, 10);
}

function addDays(str, days) {
	const d = parseDay(str);
	d.setUTCDate(d.getUTCDate() + days);
	return formatDay(d);
}

function monthKey(str) {
	return str.substring(0, 7);
}

function firstOfMonth(str) {
	return `${monthKey(str)}-01`;
}

function firstOfNextMonth(str) {
	const d = parseDay(firstOfMonth(str));
	d.setUTCMonth(d.getUTCMonth() + 1);
	return formatDay(d);
}

function lastOfMonth(str) {
	return addDays(firstOfNextMonth(str), -1);
}

function lastOfYear(str) {
	return `${str.substring(0, 4)}-12-31`;
}

function isValidDay(str) {
	return typeof str === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(str) && !isNaN(parseDay(str).getTime());
}

/**
 * `year` when the range is exactly whole calendar years, `day` otherwise.
 *
 * @param {string} start - first day
 * @param {string} end - last day
 */
function groupByFor(start, end) {
	if (start.endsWith('-01-01') && end.endsWith('-12-31')) {
		return 'year';
	}
	return 'day';
}

class WaterConsumptionTracker {
	/**
	 * @param {object} opts - options
	 * @param {string} opts.applianceId - appliance id (for logging)
	 * @param {(start: string, end: string, groupBy: string) => Promise<number>} opts.fetchTotal - summed consumption of the full days from start to end
	 * @param {() => Promise<object | null>} opts.load - read the stored state
	 * @param {(data: object) => Promise<void>} opts.save - store the state
	 * @param {() => string} opts.today - today's local date as YYYY-MM-DD
	 * @param {object} opts.log - adapter.log compatible logger
	 */
	constructor({ applianceId, fetchTotal, load, save, today, log }) {
		this.applianceId = applianceId;
		this._fetchTotal = fetchTotal;
		this._load = load;
		this._save = save;
		this._today = today;
		this.log = log;

		this._loaded = false;
		this._running = null;
		this._reset();
	}

	_reset() {
		this.baseTotal = 0;
		this.baseUntil = null;
		this.months = {};
		this.syncedUntil = null;
	}

	/**
	 * Total of all full days up to and including `day`, or null if not synced that far.
	 *
	 * @param {string} day - YYYY-MM-DD
	 */
	totalUntil(day) {
		if (this.syncedUntil === null || this.syncedUntil < day) {
			return null;
		}
		const months = Object.values(this.months).reduce((a, b) => a + b, 0);
		return Math.round((this.baseTotal + months) * 100) / 100;
	}

	/**
	 * Bring the stored total up to yesterday.
	 *
	 * Progress is saved after every successful step, so an error (timeout, API error)
	 * only loses the step that failed and the next call continues from there.
	 *
	 * @param {string} installDate - YYYY-MM-DD
	 */
	async sync(installDate) {
		if (!this._running) {
			this._running = this._doSync(installDate).finally(() => {
				this._running = null;
			});
		}
		return this._running;
	}

	async _doSync(installDate) {
		await this._loadOnce();
		const today = this._today();
		const yesterday = addDays(today, -1);

		while (this.syncedUntil === null) {
			await this._fetchNextHistoryChunk(installDate, today);
		}

		if (this.syncedUntil < yesterday) {
			await this._syncRecentMonths(yesterday);
		}
	}

	async _fetchNextHistoryChunk(installDate, today) {
		const historyEnd = addDays(firstOfMonth(today), -1);
		const chunkStart = this.baseUntil === null ? installDate : addDays(this.baseUntil, 1);

		if (chunkStart > historyEnd) {
			// Everything before the current month is covered (or the device was
			// installed this month): hand over to the monthly sync.
			this.baseUntil = historyEnd;
			this.syncedUntil = historyEnd;
			this.log.info(
				`Historical water consumption of ${this.applianceId} complete: ` +
					`${Math.round(this.baseTotal * 100) / 100} l up to ${historyEnd}`,
			);
		} else {
			const yearEnd = lastOfYear(chunkStart);
			const chunkEnd = yearEnd < historyEnd ? yearEnd : historyEnd;
			this.log.debug(
				`Fetching historical water consumption of ${this.applianceId} from ${chunkStart} to ${chunkEnd}`,
			);
			this.baseTotal += await this._fetch(chunkStart, chunkEnd);
			this.baseUntil = chunkEnd;
		}

		await this._persist();
	}

	/**
	 * Re-fetch every month from syncedUntil's month to yesterday's.
	 *
	 * Each month's value is overwritten, not added to, so a retry after a partial
	 * failure can't count anything twice. Starting at syncedUntil's month means the
	 * previous month is fetched again on the 1st and 2nd of a new month, which picks
	 * up values the device uploaded late.
	 *
	 * @param {string} yesterday - YYYY-MM-DD
	 */
	async _syncRecentMonths(yesterday) {
		const fetched = {};
		const afterBase = addDays(this.baseUntil, 1);
		let monthStart = firstOfMonth(this.syncedUntil);
		while (monthStart <= yesterday) {
			const start = monthStart > afterBase ? monthStart : afterBase;
			const monthEnd = lastOfMonth(monthStart);
			const end = monthEnd < yesterday ? monthEnd : yesterday;
			if (start <= end) {
				fetched[monthKey(monthStart)] = await this._fetch(start, end);
			}
			monthStart = firstOfNextMonth(monthStart);
		}

		Object.assign(this.months, fetched);
		this.syncedUntil = yesterday;
		this._foldOldMonths(yesterday);
		await this._persist();
	}

	/**
	 * Move months before the previous one into baseTotal; they won't be re-fetched.
	 *
	 * @param {string} yesterday - YYYY-MM-DD
	 */
	_foldOldMonths(yesterday) {
		const keepFrom = monthKey(addDays(firstOfMonth(yesterday), -1));
		for (const key of Object.keys(this.months).sort()) {
			if (key >= keepFrom) {
				break;
			}
			this.baseTotal += this.months[key];
			delete this.months[key];
			this.baseUntil = lastOfMonth(`${key}-01`);
		}
	}

	async _fetch(start, end) {
		return this._fetchTotal(start, end, groupByFor(start, end));
	}

	async _loadOnce() {
		if (this._loaded) {
			return;
		}
		const stored = await this._load();
		this._loaded = true;
		if (!stored) {
			return;
		}
		const valid =
			typeof stored.baseTotal === 'number' &&
			isFinite(stored.baseTotal) &&
			(stored.baseUntil === null || isValidDay(stored.baseUntil)) &&
			(stored.syncedUntil === null || isValidDay(stored.syncedUntil)) &&
			(stored.syncedUntil === null || stored.baseUntil !== null) &&
			stored.months !== null &&
			typeof stored.months === 'object' &&
			Object.entries(stored.months).every(([k, v]) => /^\d{4}-\d{2}$/.test(k) && typeof v === 'number');
		if (!valid) {
			this.log.warn(`Stored water consumption of ${this.applianceId} is invalid, fetching it again`);
			return;
		}
		this.baseTotal = stored.baseTotal;
		this.baseUntil = stored.baseUntil;
		this.months = { ...stored.months };
		this.syncedUntil = stored.syncedUntil;
	}

	async _persist() {
		await this._save({
			baseTotal: this.baseTotal,
			baseUntil: this.baseUntil,
			months: { ...this.months },
			syncedUntil: this.syncedUntil,
		});
	}
}

module.exports = { WaterConsumptionTracker, groupByFor, addDays };

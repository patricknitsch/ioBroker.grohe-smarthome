'use strict';

const BASE = 'https://idp2-apigw.cloud.grohe.com/v3/iot';

/**
 * Dumps the complete Grohe API structure to the adapter log (warn level).
 * Intended for diagnostics when the /dashboard endpoint is not available.
 *
 * @param {object} client - GroheClient instance
 * @param {object} log    - adapter.log compatible logger
 */
async function dumpApiStructure(client, log) {
	const userId = client._getUserIdFromToken();
	const today = new Date().toISOString().split('T')[0];
	const yearAgo = new Date(Date.now() - 365 * 86400000).toISOString().split('T')[0];

	log.warn('=== API STRUCTURE DUMP START ===');

	// /users/{userId}
	await _dump(client, log, `${BASE}/users/${userId}`);

	// /dashboard
	await _dump(client, log, `${BASE}/dashboard`);

	// /locations
	const locations = await _dump(client, log, `${BASE}/locations`);

	// /profile/notifications
	await _dump(client, log, `${BASE}/profile/notifications?pageSize=5`);

	// Discover locations via /users if /locations failed
	let locationList = [];
	if (Array.isArray(locations)) {
		locationList = locations;
	} else {
		try {
			locationList = await client._getLocationsViaUser();
		} catch (err) {
			log.warn(`[dump] Could not get locations via /users: ${err.message}`);
		}
	}

	for (const loc of locationList) {
		const locId = loc.id;
		log.warn(`[dump] --- Location ${locId} ---`);

		await _dump(client, log, `${BASE}/locations/${locId}`);
		const rooms = await _dump(client, log, `${BASE}/locations/${locId}/rooms`);
		const roomList = Array.isArray(rooms) ? rooms : [];

		for (const room of roomList) {
			const roomId = room.id;
			log.warn(`[dump] --- Location ${locId} / Room ${roomId} ---`);

			await _dump(client, log, `${BASE}/locations/${locId}/rooms/${roomId}`);
			const appliances = await _dump(client, log, `${BASE}/locations/${locId}/rooms/${roomId}/appliances`);
			const appList = Array.isArray(appliances) ? appliances : [];

			for (const app of appList) {
				const appId = app.appliance_id;
				const appBase = `${BASE}/locations/${locId}/rooms/${roomId}/appliances/${appId}`;
				log.warn(`[dump] --- Appliance ${appId} (type=${app.type}, name=${app.name}) ---`);

				await _dump(client, log, appBase);
				await _dump(client, log, `${appBase}/details`);
				await _dump(client, log, `${appBase}/status`);
				await _dump(client, log, `${appBase}/command`);
				await _dump(client, log, `${appBase}/notifications?pageSize=10`);
				await _dump(client, log, `${appBase}/pressuremeasurement`);
				await _dump(client, log, `${appBase}/data/aggregated?from=${yearAgo}&to=${today}&groupBy=month`);
				await _dump(client, log, `${appBase}/data/aggregated?from=${today}&to=${today}&groupBy=day`);
			}
		}
	}

	log.warn('=== API STRUCTURE DUMP END ===');
}

async function _dump(client, log, url) {
	try {
		const resp = await client.request({ method: 'GET', url });
		log.warn(`[dump] GET ${url} → ${resp.status}: ${JSON.stringify(resp.data)}`);
		return resp.data;
	} catch (err) {
		const status = err?.response?.status || 'N/A';
		const body = err?.response?.data;
		let bodyStr = '';
		if (body) {
			try {
				bodyStr = JSON.stringify(body);
			} catch {
				bodyStr = '[unserializable]';
			}
		}
		log.warn(`[dump] GET ${url} → ${status}: ${bodyStr || err.message}`);
		return null;
	}
}

module.exports = { dumpApiStructure };

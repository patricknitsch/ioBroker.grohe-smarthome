'use strict';

// ============================================================================
// Backend side of the web component (admin/webcomponents/device-card.*):
// answers the `getDevices` request of its settings (selectSendTo) with the
// Grohe appliances of this instance.
// ============================================================================

/** Appliance types as shown next to the device name */
const TYPE_LABELS = {
	SENSE: 'Sense',
	SENSE_GUARD: 'Sense Guard',
	BLUE_HOME: 'Blue Home',
	BLUE_PROFESSIONAL: 'Blue Professional',
};

/**
 * Appliances of the instance as options of a `selectSendTo`.
 *
 * @param {Pick<ioBroker.Adapter, 'getDevicesAsync' | 'namespace'>} adapter adapter instance
 * @returns {Promise<{value: string, label: string}[]>} options; `value` is the full device id
 */
async function getDeviceOptions(adapter) {
	const devices = await adapter.getDevicesAsync();
	const prefix = `${adapter.namespace}.`;
	const options = [];
	for (const device of devices) {
		const id = String(device._id || '');
		// appliances sit directly below the instance; anything deeper is not one of ours
		if (!id.startsWith(prefix) || id.slice(prefix.length).includes('.')) {
			continue;
		}
		const applianceId = id.slice(prefix.length);
		const name = nameOf(device.common?.name, applianceId);
		const type = TYPE_LABELS[String(device.native?.type)];
		// device names already end with "(Sense)" etc.; don't repeat the type then
		const label = type && !name.includes(`(${type})`) ? `${name} (${type})` : name;
		options.push({ value: id, label });
	}
	return options.sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * @param {ioBroker.StringOrTranslated | undefined} name object name
 * @param {string} fallback used if empty
 * @returns {string} plain name
 */
function nameOf(name, fallback) {
	if (name && typeof name === 'object') {
		return String(name.en || Object.values(name)[0] || fallback);
	}
	return String(name || fallback);
}

module.exports = { getDeviceOptions };

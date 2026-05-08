'use strict';

const { DeviceManagement } = require('@iobroker/dm-utils');
const FULL_WIDTH_SIZE = 12;

class GroheDeviceManagement extends DeviceManagement {
	handleAdapterMessage(obj) {
		this['onMessage'](obj);
	}

	getInstanceInfo() {
		return {
			...super.getInstanceInfo(),
			identifierLabel: {
				en: 'Appliance ID',
				de: 'Geräte-ID',
			},
			smallCards: false,
		};
	}

	async loadDevices(context) {
		const devices = await this.adapter.getDevicesAsync();
		const prefix = `${this.adapter.namespace}.`;
		const adapterDevices = devices.filter(
			device => device.type === 'device' && String(device._id || '').startsWith(prefix),
		);

		context.setTotalDevices(adapterDevices.length);

		for (const device of adapterDevices) {
			const applianceId = String(device._id).slice(prefix.length);
			const name = device.common?.name || applianceId;
			const type = String(device.native?.type || 'UNKNOWN');
			const template = this._getDeviceTemplate(type, applianceId);

			context.addDevice({
				id: applianceId,
				name,
				icon: `/adapter/${this.adapter.name}/grohe-smarthome.png`,
				manufacturer: 'Grohe',
				model: type,
				status: template.statusItems,
				hasDetails: true,
				customInfo: {
					id: `card/${applianceId}`,
					schema: {
						type: 'panel',
						items: template.mainTileItems,
					},
				},
				group: {
					key: `type/${type}`,
					name: this._getTypeLabel(type),
				},
				actions: [],
			});
		}
	}

	async getDeviceDetails(deviceId) {
		const obj = await this.adapter.getObjectAsync(deviceId);
		const type = String(obj?.native?.type || 'UNKNOWN');
		const template = this._getDeviceTemplate(type, deviceId);

		/** @type {any} */
		const details = {
			id: String(deviceId),
			schema: {
				type: 'tabs',
				items: {
					_tab_info: {
						type: 'panel',
						label: { en: 'Info', de: 'Info' },
						items: template.infoTabItems,
					},
				},
			},
		};

		if (template.hasControls) {
			details.schema.items._tab_controls = {
				type: 'panel',
				label: { en: 'Controls', de: 'Steuerung' },
				items: template.controlTabItems,
			};
		}

		return details;
	}

	_getDeviceTemplate(type, deviceId) {
		const fullId = `${this.adapter.namespace}.${deviceId}`;

		if (type === 'SENSE') {
			return this._getSenseTemplate(fullId, deviceId);
		}
		if (type === 'SENSE_GUARD') {
			return this._getGuardTemplate(fullId, deviceId);
		}
		if (type === 'BLUE_HOME' || type === 'BLUE_PROFESSIONAL') {
			return this._getBlueTemplate(fullId, deviceId, type);
		}
		return this._getDefaultTemplate(fullId, deviceId);
	}

	_getCommonStatusItems(deviceId) {
		return {
			connection: {
				stateId: `${this.adapter.namespace}.${deviceId}.status.online`,
				mapping: { true: 'connected', false: 'disconnected' },
			},
			rssi: { stateId: `${this.adapter.namespace}.${deviceId}.status.wifiQuality` },
		};
	}

	_getCommonInfoTabItems(fullId, type, deviceId) {
		return {
			_h1: this._headerItem({ en: 'General', de: 'Allgemein' }),
			_d1: this._dividerItem(),
			applianceId: this._staticInfoItem({ en: 'Appliance ID', de: 'Geräte-ID' }, String(deviceId)),
			deviceType: this._staticInfoItem({ en: 'Type', de: 'Typ' }, this._getTypeLabel(type)),
			online: this._boolStateItem(`${fullId}.status.online`, { en: 'Online', de: 'Online' }),
			updateAvailable: this._boolStateItem(`${fullId}.status.updateAvailable`, {
				en: 'Update available',
				de: 'Update verfügbar',
			}),
			wifiQuality: this._stateItem(`${fullId}.status.wifiQuality`, { en: 'WiFi quality', de: 'WLAN-Qualität' }),
			latestNotification: this._stateItem(`${fullId}.notifications.latestMessage`, {
				en: 'Latest notification',
				de: 'Letzte Meldung',
			}),
			latestNotificationTime: this._stateItem(`${fullId}.notifications.latestTimestamp`, {
				en: 'Notification timestamp',
				de: 'Zeitstempel Meldung',
			}),
		};
	}

	_getSenseTemplate(fullId, deviceId) {
		return {
			statusItems: {
				...this._getCommonStatusItems(deviceId),
				battery: { stateId: `${this.adapter.namespace}.${deviceId}.battery` },
			},
			mainTileItems: {
				temperature: this._stateItem(`${fullId}.temperature`, { en: 'Temperature', de: 'Temperatur' }, '°C'),
				humidity: this._stateItem(`${fullId}.humidity`, { en: 'Humidity', de: 'Luftfeuchte' }, '%'),
				battery: this._stateItem(`${fullId}.battery`, { en: 'Battery', de: 'Batterie' }, '%'),
			},
			infoTabItems: {
				...this._getCommonInfoTabItems(fullId, 'SENSE', deviceId),
				_h2: this._headerItem({ en: 'Measurements', de: 'Messungen' }),
				_d2: this._dividerItem(),
				temperature: this._stateItem(`${fullId}.temperature`, { en: 'Temperature', de: 'Temperatur' }, '°C'),
				humidity: this._stateItem(`${fullId}.humidity`, { en: 'Humidity', de: 'Luftfeuchte' }, '%'),
				battery: this._stateItem(`${fullId}.battery`, { en: 'Battery', de: 'Batterie' }, '%'),
				lastMeasurement: this._stateItem(`${fullId}.lastMeasurement`, {
					en: 'Last measurement',
					de: 'Letzte Messung',
				}),
			},
			controlTabItems: {},
			hasControls: false,
		};
	}

	_getGuardTemplate(fullId, deviceId) {
		return {
			statusItems: {
				...this._getCommonStatusItems(deviceId),
				warning: {
					stateId: `${this.adapter.namespace}.${deviceId}.valveOpen`,
					mapping: { false: true, true: false },
				},
			},
			mainTileItems: {
				temperature: this._stateItem(
					`${fullId}.temperature`,
					{ en: 'Water temperature', de: 'Wassertemperatur' },
					'°C',
				),
				flowRate: this._stateItem(`${fullId}.flowRate`, { en: 'Flow rate', de: 'Durchfluss' }, 'l/h'),
				pressure: this._stateItem(`${fullId}.pressure`, { en: 'Pressure', de: 'Druck' }, 'bar'),
				consumption: this._stateItem(
					`${fullId}.consumption.daily`,
					{ en: 'Daily consumption', de: 'Tagesverbrauch' },
					'l',
				),
			},
			infoTabItems: {
				...this._getCommonInfoTabItems(fullId, 'SENSE_GUARD', deviceId),
				_h2: this._headerItem({ en: 'Measurements', de: 'Messungen' }),
				_d2: this._dividerItem(),
				valveOpen: this._boolStateItem(`${fullId}.valveOpen`, { en: 'Valve open', de: 'Ventil offen' }),
				temperature: this._stateItem(
					`${fullId}.temperature`,
					{ en: 'Water temperature', de: 'Wassertemperatur' },
					'°C',
				),
				flowRate: this._stateItem(`${fullId}.flowRate`, { en: 'Flow rate', de: 'Durchfluss' }, 'l/h'),
				pressure: this._stateItem(`${fullId}.pressure`, { en: 'Pressure', de: 'Druck' }, 'bar'),
				dailyConsumption: this._stateItem(
					`${fullId}.consumption.daily`,
					{ en: 'Daily consumption', de: 'Tagesverbrauch' },
					'l',
				),
				totalConsumption: this._stateItem(
					`${fullId}.consumption.totalWaterConsumption`,
					{ en: 'Total consumption', de: 'Gesamtverbrauch' },
					'l',
				),
				pressureDrop: this._stateItem(
					`${fullId}.pressureMeasurement.dropOfPressure`,
					{ en: 'Pressure drop', de: 'Druckabfall' },
					'bar',
				),
			},
			controlTabItems: {
				headerValve: this._headerItem({ en: 'Valve control', de: 'Ventilsteuerung' }),
				dividerValve: this._dividerItem(),
				valveOpen: this._setStateItem(`${fullId}.controls.valveOpen`, {
					en: 'Open valve',
					de: 'Ventil öffnen',
				}),
				valveClose: this._setStateItem(`${fullId}.controls.valveClose`, {
					en: 'Close valve',
					de: 'Ventil schließen',
				}),
				headerPressure: this._headerItem({ en: 'Pressure measurement', de: 'Druckmessung' }),
				dividerPressure: this._dividerItem(),
				startPressureMeasurement: this._setStateItem(`${fullId}.controls.startPressureMeasurement`, {
					en: 'Start pressure measurement',
					de: 'Druckmessung starten',
				}),
			},
			hasControls: true,
		};
	}

	_getBlueTemplate(fullId, deviceId, type) {
		return {
			statusItems: this._getCommonStatusItems(deviceId),
			mainTileItems: {
				remainingCo2: this._stateItem(
					`${fullId}.remainingCo2`,
					{ en: 'CO₂ remaining', de: 'CO₂ verbleibend' },
					'%',
				),
				remainingFilter: this._stateItem(
					`${fullId}.remainingFilter`,
					{ en: 'Filter remaining', de: 'Filter verbleibend' },
					'%',
				),
				lastMeasurement: this._stateItem(`${fullId}.lastMeasurement`, {
					en: 'Last measurement',
					de: 'Letzte Messung',
				}),
			},
			infoTabItems: {
				...this._getCommonInfoTabItems(fullId, type, deviceId),
				_h2: this._headerItem({ en: 'Resources', de: 'Ressourcen' }),
				_d2: this._dividerItem(),
				remainingCo2: this._stateItem(
					`${fullId}.remainingCo2`,
					{ en: 'CO₂ remaining', de: 'CO₂ verbleibend' },
					'%',
				),
				remainingFilter: this._stateItem(
					`${fullId}.remainingFilter`,
					{ en: 'Filter remaining', de: 'Filter verbleibend' },
					'%',
				),
				remainingCo2Liters: this._stateItem(
					`${fullId}.remainingCo2Liters`,
					{ en: 'CO₂ remaining (liters)', de: 'CO₂ verbleibend (Liter)' },
					'l',
				),
				remainingFilterLiters: this._stateItem(
					`${fullId}.remainingFilterLiters`,
					{ en: 'Filter remaining (liters)', de: 'Filter verbleibend (Liter)' },
					'l',
				),
				lastMeasurement: this._stateItem(`${fullId}.lastMeasurement`, {
					en: 'Last measurement',
					de: 'Letzte Messung',
				}),
			},
			controlTabItems: {
				headerDispense: this._headerItem({ en: 'Dispense', de: 'Zapfen' }),
				dividerDispense: this._dividerItem(),
				tapType: {
					type: 'state',
					oid: `${fullId}.controls.tapType`,
					foreign: true,
					label: { en: 'Tap type', de: 'Zapfart' },
					control: 'select',
					options: [
						{ value: 1, label: { en: 'Still', de: 'Still' } },
						{ value: 2, label: { en: 'Medium', de: 'Medium' } },
						{ value: 3, label: { en: 'Carbonated', de: 'Sprudel' } },
					],
					size: FULL_WIDTH_SIZE,
					newLine: true,
				},
				tapAmount: {
					type: 'state',
					oid: `${fullId}.controls.tapAmount`,
					foreign: true,
					label: { en: 'Amount (ml)', de: 'Menge (ml)' },
					control: 'input',
					min: 50,
					max: 2000,
					step: 50,
					size: FULL_WIDTH_SIZE,
					newLine: true,
				},
				dispense: this._setStateItem(`${fullId}.controls.dispenseTrigger`, {
					en: 'Dispense',
					de: 'Zapfen',
				}),
				headerService: this._headerItem({ en: 'Service', de: 'Service' }),
				dividerService: this._dividerItem(),
				resetCo2: this._setStateItem(`${fullId}.controls.resetCo2`, {
					en: 'Reset CO₂',
					de: 'CO₂ zurücksetzen',
				}),
				resetFilter: this._setStateItem(`${fullId}.controls.resetFilter`, {
					en: 'Reset filter',
					de: 'Filter zurücksetzen',
				}),
			},
			hasControls: true,
		};
	}

	_getDefaultTemplate(fullId, deviceId) {
		return {
			statusItems: {
				connection: {
					stateId: `${this.adapter.namespace}.${deviceId}.status.online`,
					mapping: { true: 'connected', false: 'disconnected' },
				},
			},
			mainTileItems: {
				status: this._boolStateItem(`${fullId}.status.online`, { en: 'Online', de: 'Online' }),
			},
			infoTabItems: this._getCommonInfoTabItems(fullId, 'UNKNOWN', deviceId),
			controlTabItems: {},
			hasControls: false,
		};
	}

	_headerItem(text) {
		return {
			type: 'header',
			text,
			sm: FULL_WIDTH_SIZE,
			newLine: true,
		};
	}

	_dividerItem() {
		return {
			type: 'divider',
			color: 'primary',
		};
	}

	_staticInfoItem(label, data) {
		return {
			type: 'staticInfo',
			label,
			data,
			size: FULL_WIDTH_SIZE,
			addColon: true,
			newLine: true,
		};
	}

	_boolStateItem(oid, label) {
		return {
			type: 'state',
			oid,
			foreign: true,
			label,
			trueText: { en: 'Yes', de: 'Ja' },
			falseText: { en: 'No', de: 'Nein' },
			size: FULL_WIDTH_SIZE,
			newLine: true,
		};
	}

	_stateItem(oid, label, unit) {
		const item = {
			type: 'state',
			oid,
			foreign: true,
			label,
			size: FULL_WIDTH_SIZE,
			newLine: true,
		};
		if (unit) {
			item.unit = unit;
		}
		return item;
	}

	_setStateItem(id, label) {
		return {
			type: 'setState',
			id,
			label,
			val: true,
			variant: 'contained',
			color: 'primary',
			newLine: true,
		};
	}

	_getTypeLabel(type) {
		switch (type) {
			case 'SENSE':
				return { en: 'Grohe Sense', de: 'Grohe Sense' };
			case 'SENSE_GUARD':
				return { en: 'Grohe Sense Guard', de: 'Grohe Sense Guard' };
			case 'BLUE_HOME':
				return { en: 'Grohe Blue Home', de: 'Grohe Blue Home' };
			case 'BLUE_PROFESSIONAL':
				return { en: 'Grohe Blue Professional', de: 'Grohe Blue Professional' };
			default:
				return { en: 'Grohe device', de: 'Grohe Gerät' };
		}
	}
}

module.exports = { GroheDeviceManagement };

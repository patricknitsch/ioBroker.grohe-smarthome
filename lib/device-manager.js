'use strict';

const { DeviceManagement } = require('@iobroker/dm-utils');

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

			context.addDevice({
				id: applianceId,
				identifier: applianceId,
				name,
				icon: `/adapter/${this.adapter.name}/grohe-smarthome.png`,
				status: {
					connection: {
						stateId: `${this.adapter.namespace}.${applianceId}.status.online`,
						mapping: { true: 'connected', false: 'disconnected' },
					},
				},
				controls: this._getCardControls(applianceId, type),
				hasDetails: true,
				customInfo: {
					id: `card/${applianceId}`,
					schema: {
						type: 'panel',
						items: this._getMainTileItems(applianceId, type),
					},
				},
				group: {
					key: `type/${type}`,
					name: this._getTypeLabel(type),
				},
			});
		}
	}

	async getDeviceDetails(deviceId) {
		const obj = await this.adapter.getObjectAsync(deviceId);
		const type = String(obj?.native?.type || 'UNKNOWN');
		const fullId = `${this.adapter.namespace}.${deviceId}`;

		return /** @type {any} */ ({
			id: String(deviceId),
			schema: {
				type: 'tabs',
				items: {
					info: {
						type: 'panel',
						label: { en: 'Info', de: 'Info' },
						items: {
							applianceId: {
								type: 'staticInfo',
								label: { en: 'Appliance ID', de: 'Geräte-ID' },
								data: String(deviceId),
								addColon: true,
								newLine: true,
							},
							deviceType: {
								type: 'staticInfo',
								label: { en: 'Type', de: 'Typ' },
								data: this._getTypeLabel(type),
								addColon: true,
								newLine: true,
							},
							...this._getInfoTabItems(fullId, type),
						},
					},
					controls: {
						type: 'panel',
						label: { en: 'Controls', de: 'Steuerung' },
						items: this._getControlTabItems(fullId, type),
					},
				},
			},
		});
	}

	_getCardControls(deviceId, type) {
		const controls = [
			{
				id: 'cloudConnection',
				type: 'icon',
				stateId: `${this.adapter.namespace}.info.connection`,
				icon: 'cloud_off',
				iconOn: 'cloud_done',
				label: { en: 'Cloud connection', de: 'Cloud-Verbindung' },
				color: 'error',
				colorOn: 'success',
			},
			{
				id: 'wifiConnection',
				type: 'icon',
				stateId: `${this.adapter.namespace}.${deviceId}.status.online`,
				icon: 'wifi_off',
				iconOn: 'wifi',
				label: { en: 'WiFi connection', de: 'WLAN-Verbindung' },
				color: 'error',
				colorOn: 'success',
			},
			{
				id: 'wifiQuality',
				type: 'info',
				stateId: `${this.adapter.namespace}.${deviceId}.status.wifiQuality`,
				icon: 'signal_wifi_4_bar',
				label: { en: 'WiFi quality', de: 'WLAN-Qualität' },
				unit: '%',
			},
		];

		if (type === 'SENSE_GUARD') {
			controls.push({
				id: 'valveState',
				type: 'icon',
				stateId: `${this.adapter.namespace}.${deviceId}.valveOpen`,
				icon: 'water_drop',
				iconOn: 'water_drop',
				label: { en: 'Valve state', de: 'Ventilstatus' },
				color: 'error',
				colorOn: 'success',
			});
		}

		return controls;
	}

	_getMainTileItems(deviceId, type) {
		const fullId = `${this.adapter.namespace}.${deviceId}`;
		if (type === 'SENSE') {
			return {
				temperature: this._stateItem(`${fullId}.temperature`, { en: 'Temperature', de: 'Temperatur' }, '°C'),
				humidity: this._stateItem(`${fullId}.humidity`, { en: 'Humidity', de: 'Luftfeuchte' }, '%'),
				battery: this._stateItem(`${fullId}.battery`, { en: 'Battery', de: 'Batterie' }, '%'),
			};
		}

		if (type === 'SENSE_GUARD') {
			return {
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
			};
		}

		if (type === 'BLUE_HOME' || type === 'BLUE_PROFESSIONAL') {
			return {
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
			};
		}

		return {
			status: this._stateItem(`${fullId}.status.online`, { en: 'Online', de: 'Online' }),
		};
	}

	_getInfoTabItems(fullId, type) {
		const commonItems = {
			online: this._stateItem(`${fullId}.status.online`, { en: 'Online', de: 'Online' }),
			updateAvailable: this._stateItem(`${fullId}.status.updateAvailable`, {
				en: 'Update available',
				de: 'Update verfügbar',
			}),
			wifiQuality: this._stateItem(
				`${fullId}.status.wifiQuality`,
				{ en: 'WiFi quality', de: 'WLAN-Qualität' },
				'%',
			),
			latestNotification: this._stateItem(`${fullId}.notifications.latestMessage`, {
				en: 'Latest notification',
				de: 'Letzte Meldung',
			}),
			latestNotificationTime: this._stateItem(`${fullId}.notifications.latestTimestamp`, {
				en: 'Notification timestamp',
				de: 'Zeitstempel Meldung',
			}),
		};

		if (type === 'SENSE') {
			return {
				...commonItems,
				temperature: this._stateItem(`${fullId}.temperature`, { en: 'Temperature', de: 'Temperatur' }, '°C'),
				humidity: this._stateItem(`${fullId}.humidity`, { en: 'Humidity', de: 'Luftfeuchte' }, '%'),
				battery: this._stateItem(`${fullId}.battery`, { en: 'Battery', de: 'Batterie' }, '%'),
				lastMeasurement: this._stateItem(`${fullId}.lastMeasurement`, {
					en: 'Last measurement',
					de: 'Letzte Messung',
				}),
			};
		}

		if (type === 'SENSE_GUARD') {
			return {
				...commonItems,
				valveOpen: this._stateItem(`${fullId}.valveOpen`, { en: 'Valve open', de: 'Ventil offen' }),
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
			};
		}

		if (type === 'BLUE_HOME' || type === 'BLUE_PROFESSIONAL') {
			return {
				...commonItems,
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
			};
		}

		return commonItems;
	}

	_getControlTabItems(fullId, type) {
		if (type === 'SENSE_GUARD') {
			return {
				valveOpen: this._setStateItem(`${fullId}.controls.valveOpen`, {
					en: 'Open valve',
					de: 'Ventil öffnen',
				}),
				valveClose: this._setStateItem(`${fullId}.controls.valveClose`, {
					en: 'Close valve',
					de: 'Ventil schließen',
				}),
				startPressureMeasurement: this._setStateItem(`${fullId}.controls.startPressureMeasurement`, {
					en: 'Start pressure measurement',
					de: 'Druckmessung starten',
				}),
			};
		}

		if (type === 'BLUE_HOME' || type === 'BLUE_PROFESSIONAL') {
			return {
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
				},
				dispense: this._setStateItem(`${fullId}.controls.dispenseTrigger`, {
					en: 'Dispense',
					de: 'Zapfen',
				}),
				resetCo2: this._setStateItem(`${fullId}.controls.resetCo2`, {
					en: 'Reset CO₂',
					de: 'CO₂ zurücksetzen',
				}),
				resetFilter: this._setStateItem(`${fullId}.controls.resetFilter`, {
					en: 'Reset filter',
					de: 'Filter zurücksetzen',
				}),
			};
		}

		return {
			noControls: {
				type: 'staticText',
				text: {
					en: 'No controls available for this device.',
					de: 'Für dieses Gerät sind keine Steuerungen verfügbar.',
				},
			},
		};
	}

	_stateItem(oid, label, unit) {
		const item = {
			type: 'state',
			oid,
			foreign: true,
			label,
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

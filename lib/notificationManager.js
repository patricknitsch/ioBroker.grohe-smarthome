'use strict';

/**
 * Sends a notification to all enabled notification providers.
 *
 * Each provider is enabled via a checkbox in the adapter configuration and the user
 * selects the concrete adapter instance (e.g. telegram.0) in the settings.
 *
 * Supported providers: Telegram, Pushover, WhatsApp (whatsapp-cmb), Email, Signal (signal-cmb),
 * Matrix (matrix-org), Synology Chat (synochat).
 *
 * @param {object} adapter - The ioBroker adapter instance.
 * @param {string} text    - The notification message to send.
 */
async function sendNotification(adapter, text) {
	if (!adapter.config.notifyEnabled) {
		return;
	}
	const textWithHeader = `grohe-smarthome:\n${text}`;

	// Telegram
	if (adapter.config.notifyUseTelegram && adapter.config.notifyInstanceTelegram) {
		try {
			const payload = { text: textWithHeader };
			if (adapter.config.notifyUserTelegram) {
				payload.user = adapter.config.notifyUserTelegram;
			}
			await adapter.sendToAsync(adapter.config.notifyInstanceTelegram, 'send', payload);
		} catch (e) {
			adapter.log.error(`[sendNotification Telegram] ${e.message}`);
		}
	} else if (adapter.config.notifyUseTelegram) {
		adapter.log.warn('[sendNotification Telegram] Telegram is enabled but no instance is configured.');
	}

	// Pushover
	if (adapter.config.notifyUsePushover && adapter.config.notifyInstancePushover) {
		try {
			const payload = {
				message: textWithHeader,
				title: adapter.config.notifyTitlePushover || 'Grohe Smarthome',
			};
			if (adapter.config.notifyDevicePushover) {
				payload.device = adapter.config.notifyDevicePushover;
			}
			await adapter.sendToAsync(adapter.config.notifyInstancePushover, 'send', payload);
		} catch (e) {
			adapter.log.error(`[sendNotification Pushover] ${e.message}`);
		}
	} else if (adapter.config.notifyUsePushover) {
		adapter.log.warn('[sendNotification Pushover] Pushover is enabled but no instance is configured.');
	}

	// WhatsApp (whatsapp-cmb)
	if (adapter.config.notifyUseWhatsapp && adapter.config.notifyInstanceWhatsapp) {
		try {
			const payload = { text: textWithHeader };
			if (adapter.config.notifyPhoneWhatsapp) {
				payload.phone = adapter.config.notifyPhoneWhatsapp;
			}
			await adapter.sendToAsync(adapter.config.notifyInstanceWhatsapp, 'send', payload);
		} catch (e) {
			adapter.log.error(`[sendNotification WhatsApp] ${e.message}`);
		}
	} else if (adapter.config.notifyUseWhatsapp) {
		adapter.log.warn('[sendNotification WhatsApp] WhatsApp is enabled but no instance is configured.');
	}

	// Email
	if (adapter.config.notifyUseEmail && adapter.config.notifyInstanceEmail) {
		try {
			const emailPayload = {
				text: textWithHeader,
				subject: adapter.config.notifySubjectEmail || 'Grohe Smarthome',
			};
			if (adapter.config.notifyToEmail) {
				emailPayload.sendTo = adapter.config.notifyToEmail;
			}
			await adapter.sendToAsync(adapter.config.notifyInstanceEmail, 'send', emailPayload);
		} catch (e) {
			adapter.log.error(`[sendNotification Email] ${e.message}`);
		}
	} else if (adapter.config.notifyUseEmail) {
		adapter.log.warn('[sendNotification Email] Email is enabled but no instance is configured.');
	}

	// Signal (signal-cmb)
	if (adapter.config.notifyUseSignal && adapter.config.notifyInstanceSignal) {
		try {
			const payload = { text: textWithHeader };
			if (adapter.config.notifyPhoneSignal) {
				payload.phone = adapter.config.notifyPhoneSignal;
			}
			await adapter.sendToAsync(adapter.config.notifyInstanceSignal, 'send', payload);
		} catch (e) {
			adapter.log.error(`[sendNotification Signal] ${e.message}`);
		}
	} else if (adapter.config.notifyUseSignal) {
		adapter.log.warn('[sendNotification Signal] Signal is enabled but no instance is configured.');
	}

	// Matrix (matrix-org)
	if (adapter.config.notifyUseMatrix && adapter.config.notifyInstanceMatrix) {
		try {
			await adapter.sendToAsync(adapter.config.notifyInstanceMatrix, 'send', { text: textWithHeader });
		} catch (e) {
			adapter.log.error(`[sendNotification Matrix] ${e.message}`);
		}
	} else if (adapter.config.notifyUseMatrix) {
		adapter.log.warn('[sendNotification Matrix] Matrix is enabled but no instance is configured.');
	}

	// Synology Chat
	if (adapter.config.notifyUseSynochat && adapter.config.notifyInstanceSynochat) {
		try {
			if (!adapter.config.notifyChannelSynochat) {
				adapter.log.warn('[sendNotification] Synology Chat channel is not set. Message could not be sent.');
			} else {
				await adapter.setForeignStateAsync(
					`${adapter.config.notifyInstanceSynochat}.${adapter.config.notifyChannelSynochat}.message`,
					textWithHeader,
				);
			}
		} catch (e) {
			adapter.log.error(`[sendNotification Synology Chat] ${e.message}`);
		}
	} else if (adapter.config.notifyUseSynochat) {
		adapter.log.warn('[sendNotification Synology Chat] Synology Chat is enabled but no instance is configured.');
	}
}

module.exports = { sendNotification };

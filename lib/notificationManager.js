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

	// Telegram
	if (adapter.config.notifyUseTelegram && adapter.config.notifyInstanceTelegram) {
		try {
			const payload = { text };
			if (adapter.config.notifyUserTelegram) {
				payload.user = adapter.config.notifyUserTelegram;
			}
			await adapter.sendToAsync(adapter.config.notifyInstanceTelegram, 'send', payload);
		} catch (e) {
			adapter.log.error(`[sendNotification Telegram] ${e.message}`);
		}
	}

	// Pushover
	if (adapter.config.notifyUsePushover && adapter.config.notifyInstancePushover) {
		try {
			const payload = {
				message: text,
				title: adapter.config.notifyTitlePushover || 'Grohe Smarthome',
			};
			if (adapter.config.notifyDevicePushover) {
				payload.device = adapter.config.notifyDevicePushover;
			}
			await adapter.sendToAsync(adapter.config.notifyInstancePushover, 'send', payload);
		} catch (e) {
			adapter.log.error(`[sendNotification Pushover] ${e.message}`);
		}
	}

	// WhatsApp (whatsapp-cmb)
	if (adapter.config.notifyUseWhatsapp && adapter.config.notifyInstanceWhatsapp) {
		try {
			const payload = { text };
			if (adapter.config.notifyPhoneWhatsapp) {
				payload.phone = adapter.config.notifyPhoneWhatsapp;
			}
			await adapter.sendToAsync(adapter.config.notifyInstanceWhatsapp, 'send', payload);
		} catch (e) {
			adapter.log.error(`[sendNotification WhatsApp] ${e.message}`);
		}
	}

	// Email
	if (adapter.config.notifyUseEmail && adapter.config.notifyInstanceEmail) {
		try {
			const emailPayload = {
				text,
				subject: adapter.config.notifySubjectEmail || 'Grohe Smarthome',
			};
			if (adapter.config.notifyToEmail) {
				emailPayload.sendTo = adapter.config.notifyToEmail;
			}
			await adapter.sendToAsync(adapter.config.notifyInstanceEmail, 'send', emailPayload);
		} catch (e) {
			adapter.log.error(`[sendNotification Email] ${e.message}`);
		}
	}

	// Signal (signal-cmb)
	if (adapter.config.notifyUseSignal && adapter.config.notifyInstanceSignal) {
		try {
			const payload = { text };
			if (adapter.config.notifyPhoneSignal) {
				payload.phone = adapter.config.notifyPhoneSignal;
			}
			await adapter.sendToAsync(adapter.config.notifyInstanceSignal, 'send', payload);
		} catch (e) {
			adapter.log.error(`[sendNotification Signal] ${e.message}`);
		}
	}

	// Matrix (matrix-org)
	if (adapter.config.notifyUseMatrix && adapter.config.notifyInstanceMatrix) {
		try {
			await adapter.sendToAsync(adapter.config.notifyInstanceMatrix, 'send', { text });
		} catch (e) {
			adapter.log.error(`[sendNotification Matrix] ${e.message}`);
		}
	}

	// Synology Chat
	if (adapter.config.notifyUseSynochat && adapter.config.notifyInstanceSynochat) {
		try {
			if (!adapter.config.notifyChannelSynochat) {
				adapter.log.warn('[sendNotification] Synology Chat channel is not set. Message could not be sent.');
			} else {
				await adapter.setForeignStateAsync(
					`${adapter.config.notifyInstanceSynochat}.${adapter.config.notifyChannelSynochat}.message`,
					text,
				);
			}
		} catch (e) {
			adapter.log.error(`[sendNotification Synochat] ${e.message}`);
		}
	}
}

module.exports = { sendNotification };

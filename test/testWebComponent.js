'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const ADMIN = path.join(ROOT, 'admin');
const MANIFEST = 'webcomponents/device-card.json';
const TAG = 'grohe-device-card';
const GUARD = 'grohe-smarthome.0.guard1';
const BLUE = 'grohe-smarthome.0.blue1';
const SENSE = 'grohe-smarthome.0.sense1';
/** DOM of happy-dom, registered while the element tests run */
const dom = () => /** @type {any} */ (globalThis).document;

/** @param {string} file path below admin/ */
const readAdmin = file => fs.readFileSync(path.join(ADMIN, file), 'utf8');

describe('web component: manifest and bundle', () => {
	it('has a valid manifest whose files exist', async () => {
		const { checkManifest } = await import('@iobroker/web-components');
		const manifest = JSON.parse(readAdmin(MANIFEST));
		assert.equal(checkManifest(manifest), null);
		assert.equal(manifest.tag, TAG);
		assert.ok(fs.existsSync(path.join(ADMIN, 'webcomponents', manifest.module)));
		assert.ok(fs.existsSync(path.join(ADMIN, 'webcomponents', manifest.icon)));
	});

	it('is listed in io-package.json as a plain manifest path, which every host reads', async () => {
		// devices 4.4 skips entries in the object short form, so the list holds plain paths only
		const { getWebComponentSources } = await import('@iobroker/web-components');
		const io = JSON.parse(fs.readFileSync(path.join(ROOT, 'io-package.json'), 'utf8'));
		const list = io.common.webComponents;
		assert.deepEqual(list, [MANIFEST]);
		const sources = getWebComponentSources(
			[{ _id: 'system.adapter.grohe-smarthome.0', common: { webComponents: list } }],
			'http://localhost:8081/',
		);
		assert.equal(sources.length, 1);
		assert.match(sources[0].url, /\/adapter\/grohe-smarthome\/webcomponents\/device-card\.json$/);
	});

	it('ships a bundle that is built from the current source (run `npm run build`)', async () => {
		const { build } = await import('esbuild');
		const result = await build({
			entryPoints: [path.join(ROOT, 'src-webcomponents/device-card.js')],
			bundle: true,
			format: 'esm',
			target: 'es2022',
			minify: true,
			legalComments: 'none',
			write: false,
			logLevel: 'silent',
		});
		assert.equal(result.outputFiles[0].text, readAdmin('webcomponents/device-card.js'));
	});
});

describe('web component: element', function () {
	this.timeout(10000);
	/** @type {any} */
	let GlobalRegistrator;

	before(async () => {
		({ GlobalRegistrator } = await import('@happy-dom/global-registrator'));
		GlobalRegistrator.register({ url: 'http://localhost:8081/adapter/grohe-smarthome/webcomponents/' });
		// browser code: not part of the Node type check (see tsconfig.webcomponents.json)
		const source = '../src-webcomponents/device-card.js';
		await import(source);
	});

	after(async () => {
		await GlobalRegistrator.unregister();
	});

	const OBJECTS = {
		[GUARD]: { _id: GUARD, type: 'device', common: { name: 'Keller (Sense Guard)' }, native: { type: 'SENSE_GUARD' } },
		[BLUE]: { _id: BLUE, type: 'device', common: { name: 'Küche (Blue)' }, native: { type: 'BLUE_HOME' } },
		[SENSE]: { _id: SENSE, type: 'device', common: { name: 'Bad (Sense)' }, native: { type: 'SENSE' } },
	};

	/**
	 * Socket of a host with the states of the appliances; records the writes
	 *
	 * @param {Record<string, unknown>} values state values by full id
	 */
	function mockSocket(values) {
		/** @type {[string, unknown][]} */
		const writes = [];
		const states = Object.fromEntries(Object.entries(values).map(([k, val]) => [k, { val }]));
		return {
			writes,
			systemLang: 'de',
			subscribeState: async (ids, cb) => (Array.isArray(ids) ? ids : [ids]).forEach(id => cb(id, states[id] || null)),
			unsubscribeState: () => {},
			getState: async id => states[id] || null,
			getObject: async id => OBJECTS[id] || null,
			subscribeObject: async () => {},
			unsubscribeObject: async () => {},
			getObjectViewSystem: async () => ({ ...OBJECTS }),
			setState: async (id, val) => {
				writes.push([id, typeof val === 'object' && val !== null ? val.val : val]);
			},
		};
	}

	/** @returns {Promise<void>} after the element drew */
	const tick = () => new Promise(resolve => setTimeout(resolve, 10));

	/**
	 * @param {any} socket mock socket
	 * @param {Record<string, string>} settings settings of the host
	 */
	async function mount(socket, settings) {
		const el = /** @type {any} */ (dom().createElement(TAG));
		el.socket = socket;
		el.settings = settings;
		dom().body.appendChild(el);
		for (let i = 0; i < 4; i++) {
			await tick();
		}
		return el;
	}

	const guardValues = {
		[`${GUARD}.status.online`]: true,
		[`${GUARD}.status.wifiQuality`]: 80,
		[`${GUARD}.temperature`]: 14.25,
		[`${GUARD}.pressure`]: 3.9,
		[`${GUARD}.flowRate`]: 0,
		[`${GUARD}.valveOpen`]: true,
		[`${GUARD}.consumption.daily`]: 120,
		[`${GUARD}.controls.snooze.active`]: false,
		[`${GUARD}.controls.snooze.duration`]: 5,
		[`${GUARD}.controls.withdrawalAmountLimit`]: 300,
		[`${GUARD}.controls.sprinkler.startHour`]: 6,
		[`${GUARD}.controls.sprinkler.activeMonday`]: true,
	};

	/**
	 * @param {any} el element
	 * @param {string} tab tab to show
	 */
	async function showTab(el, tab) {
		el.shadowRoot.querySelector(`[data-tab="${tab}"]`).click();
		await tick();
	}

	it('shows name, type and the values of a Sense Guard', async () => {
		const el = await mount(mockSocket(guardValues), { device: GUARD });
		const root = el.shadowRoot;
		assert.equal(root.querySelector('.name').textContent, 'Keller (Sense Guard)');
		assert.equal(root.querySelector('.sub').textContent, 'Grohe Sense Guard');
		assert.match(root.querySelector('.values').textContent, /14,3/);
		assert.match(root.querySelector('.values').textContent, /Offen/);
		assert.ok(root.querySelector('[data-tab="controls"]'));
		el.remove();
	});

	it('opens and closes the valve through the control states', async () => {
		const socket = mockSocket(guardValues);
		const el = await mount(socket, { device: GUARD });
		await showTab(el, 'controls');
		el.shadowRoot.querySelector('[data-action="valveClose"]').click();
		await tick();
		assert.deepEqual(socket.writes, [[`${GUARD}.controls.valveClose`, true]]);
		el.remove();
	});

	it('does not start a pressure measurement while the valve is open', async () => {
		const el = await mount(mockSocket(guardValues), { device: GUARD });
		await showTab(el, 'controls');
		assert.ok(el.shadowRoot.querySelector('[data-action="pressure"]').disabled);
		el.remove();
	});

	it('stores the snooze duration before starting the snooze', async () => {
		const socket = mockSocket(guardValues);
		const el = await mount(socket, { device: GUARD });
		el.dialogs = { open: async () => ({ duration: 60 }) };
		await showTab(el, 'controls');
		el.shadowRoot.querySelector('[data-action="snoozeStart"]').click();
		await tick();
		assert.deepEqual(socket.writes, [
			[`${GUARD}.controls.snooze.duration`, 60],
			[`${GUARD}.controls.snooze.start`, true],
		]);
		el.remove();
	});

	it('writes the sprinkler values, then saves them', async () => {
		const socket = mockSocket(guardValues);
		const el = await mount(socket, { device: GUARD });
		/** @type {any} */
		let request;
		el.dialogs = {
			open: async r => {
				request = r;
				return { ...r.data, startHour: 5, activeSunday: true };
			},
		};
		await showTab(el, 'controls');
		el.shadowRoot.querySelector('[data-action="sprinkler"]').click();
		await tick();
		assert.equal(request.data.startHour, 6);
		assert.equal(request.data.activeMonday, true);
		const writes = Object.fromEntries(socket.writes);
		assert.equal(writes[`${GUARD}.controls.sprinkler.startHour`], 5);
		assert.equal(writes[`${GUARD}.controls.sprinkler.activeSunday`], true);
		assert.deepEqual(socket.writes.at(-1), [`${GUARD}.controls.sprinkler.save`, true]);
		el.remove();
	});

	it('sends nothing when a dialog is cancelled', async () => {
		const socket = mockSocket(guardValues);
		const el = await mount(socket, { device: GUARD });
		el.dialogs = { open: async () => null };
		await showTab(el, 'controls');
		el.shadowRoot.querySelector('[data-action="limit"]').click();
		await tick();
		assert.deepEqual(socket.writes, []);
		el.remove();
	});

	it('dispenses the picked type and amount on a Blue', async () => {
		const socket = mockSocket({
			[`${BLUE}.status.online`]: true,
			[`${BLUE}.remainingCo2`]: 64,
			[`${BLUE}.controls.tapType`]: 1,
			[`${BLUE}.controls.tapAmount`]: 250,
		});
		const el = await mount(socket, { device: BLUE });
		await showTab(el, 'controls');
		const root = el.shadowRoot;
		root.querySelector('[data-tap-type="3"]').click();
		await tick();
		root.querySelector('[data-amount="1"]').click();
		await tick();
		root.querySelector('[data-action="dispense"]').click();
		await tick();
		assert.deepEqual(socket.writes, [
			[`${BLUE}.controls.tapType`, 3],
			[`${BLUE}.controls.tapAmount`, 300],
			[`${BLUE}.controls.dispenseTrigger`, true],
		]);
		el.remove();
	});

	it('asks before resetting the CO₂ counter', async () => {
		const socket = mockSocket({ [`${BLUE}.status.online`]: true });
		const el = await mount(socket, { device: BLUE });
		el.dialogs = { open: async () => null };
		await showTab(el, 'controls');
		el.shadowRoot.querySelector('[data-action="resetCo2"]').click();
		await tick();
		assert.deepEqual(socket.writes, []);
		el.dialogs = { open: async () => ({}) };
		el.shadowRoot.querySelector('[data-action="resetCo2"]').click();
		await tick();
		assert.deepEqual(socket.writes, [[`${BLUE}.controls.resetCo2`, true]]);
		el.remove();
	});

	it('shows a Sense without a controls tab', async () => {
		const el = await mount(
			mockSocket({ [`${SENSE}.status.online`]: true, [`${SENSE}.temperature`]: 21.5, [`${SENSE}.battery`]: 80 }),
			{ device: SENSE },
		);
		const root = el.shadowRoot;
		assert.equal(root.querySelector('.tabs'), null);
		assert.match(root.querySelector('.values').textContent, /21,5/);
		el.remove();
	});

	it('disables the controls of an offline appliance', async () => {
		const socket = mockSocket({ ...guardValues, [`${GUARD}.status.online`]: false });
		const el = await mount(socket, { device: GUARD });
		await showTab(el, 'controls');
		const root = el.shadowRoot;
		assert.ok(root.querySelector('.header.offline'));
		assert.ok(root.querySelector('[data-action="valveClose"]').disabled);
		root.querySelector('[data-action="valveClose"]').click();
		await tick();
		assert.deepEqual(socket.writes, []);
		el.remove();
	});

	it('writes nothing in edit mode', async () => {
		const socket = mockSocket(guardValues);
		const el = await mount(socket, { device: GUARD });
		await showTab(el, 'controls');
		el.editMode = true;
		await tick();
		el.shadowRoot.querySelector('[data-action="valveClose"]').click();
		await tick();
		assert.deepEqual(socket.writes, []);
		el.remove();
	});

	it('takes the first appliance of the instance without a setting', async () => {
		const el = await mount(mockSocket(guardValues), {});
		assert.equal(el.shadowRoot.querySelector('.name').textContent, 'Küche (Blue)');
		el.remove();
	});
});

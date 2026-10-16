// -----------------------------------------------------------------------------
// End to end: the real SDK wiring (src/handlers.js) against the SDK's fake
// Gladys and the fake panel behind the transport. Timers are recorded, not
// run: the tests call the reads themselves (app.tick) and check the delay the
// next one was scheduled with.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { ProtexialApp } from '../src/app.js';
import { parseCard } from '../src/card.js';
import { ACTIONS, SCENE_ACTIONS } from '../src/constants.js';
import { registerHandlers } from '../src/handlers.js';
import { PanelError } from '../src/http.js';
import { CARD_TYPED } from './fixtures/pages.js';
import { FakePanel } from './helpers/fakePanel.js';

const CONFIG = { url: 'http://192.168.1.30', user_code: '1234', auth_card: CARD_TYPED };
const id = (device, key) => `ext:test-integration:${device}:panel${key ? `:${key}` : ''}`;

function recorder() {
  const lines = [];
  const log = (level) => (message) => lines.push(`${level} ${message}`);
  return { lines, info: log('info'), warn: log('warn'), error: log('error'), debug: () => {} };
}

function fakeTimers() {
  const pending = new Map();
  let next = 0;
  return {
    pending,
    setTimeout: (fn, ms) => {
      next += 1;
      pending.set(next, { fn, ms });
      return next;
    },
    clearTimeout: (handle) => pending.delete(handle),
    get delays() {
      return [...pending.values()].map((entry) => entry.ms);
    },
  };
}

async function setup({ config = {}, panel = new FakePanel(), transport } = {}) {
  const gladys = createFakeGladys({ config: { ...CONFIG, ...config } });
  const logger = recorder();
  const timers = fakeTimers();
  let clock = Date.parse('2026-10-16T10:00:00Z');
  const app = new ProtexialApp({
    gladys,
    logger,
    transport: transport ?? panel.transport,
    now: () => clock,
    timers,
    sleep: async () => {},
  });
  registerHandlers(gladys, app, logger);
  await gladys.connect();
  const deviceOf = (name) => gladys.fake.discoveredDevices.find((d) => d.external_id === id(name));
  const set = (name, key, value) => {
    const device = deviceOf(name);
    const feature = device.features.find((f) => f.external_id === id(name, key));
    return gladys.fake.setValue(device, feature, value);
  };
  return {
    gladys,
    app,
    panel,
    logger,
    timers,
    set,
    deviceOf,
    advance: (ms) => {
      clock += ms;
    },
    state: (name, key) => gladys.fake.lastState(id(name, key)),
    events: () => gladys.fake.sceneEvents,
  };
}

test('starts: finds the panel, reads it, publishes the devices and states', async () => {
  const { gladys, panel, state, timers } = await setup();
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((d) => d.external_id),
    [id('alarm'), id('shutters'), id('lights')],
  );
  assert.equal(state('alarm', 'mode'), 'off');
  assert.equal(state('alarm', 'zone-a'), 0);
  assert.equal(state('alarm', 'opening'), 1, 'closed');
  assert.equal(state('alarm', 'radio-link'), 1);
  assert.equal(state('alarm', 'gsm-signal'), 4);
  assert.equal(state('alarm', 'gsm-operator'), 'Orange F');
  assert.deepEqual(gladys.fake.connectionStatus, {
    connected: true,
    message: {
      en: 'Protexial 2010 (v8_1): no zone armed.',
      fr: 'Protexial 2010 (v8_1) : aucune zone armée.',
    },
  });
  assert.deepEqual(
    gladys.fake.transports.map((t) => t.transport),
    ['local', 'local', 'local'],
  );
  assert.equal(panel.session, undefined, 'logged out after the read');
  assert.deepEqual(timers.delays, [300_000], 'disarmed: the slow interval');
  assert.deepEqual(gladys.fake.sceneEvents, [], 'the first reading fires nothing');
});

test('configuration problems: nothing sent to the panel', async () => {
  for (const [config, fr] of [
    [{ url: '' }, /Saisissez l'adresse/],
    [{ user_code: '' }, /code d'accès/],
    [{ auth_card: '' }, /Carte d'authentification absente/],
    [{ auth_card: '1234 5678' }, /0 codes au lieu de 30/],
  ]) {
    const panel = new FakePanel();
    const { gladys, timers } = await setup({ config, panel });
    assert.equal(gladys.fake.connectionStatus.connected, false);
    assert.match(gladys.fake.connectionStatus.message.fr, fr);
    assert.equal(panel.requests.length, 0);
    assert.equal(timers.pending.size, 0);
  }
});

test('the next read: faster while armed, slower after errors', async () => {
  const panel = new FakePanel();
  let down = false;
  const transport = async (request) => {
    if (down) throw new PanelError('network', 'EHOSTUNREACH');
    return panel.transport(request);
  };
  const { app, timers, gladys } = await setup({ panel, transport, config: { poll_interval: 45 } });
  panel.state.zones.A = true;
  await app.tick();
  assert.deepEqual(timers.delays, [45_000]);
  down = true;
  await app.tick();
  assert.deepEqual(timers.delays, [60_000], 'backoff: at least a minute');
  await app.tick();
  await app.tick();
  assert.deepEqual(timers.delays, [300_000]);
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /Panel unreachable \(EHOSTUNREACH\), next try in 5 min/,
  );
  assert.equal(gladys.fake.transports.at(-1).transport, 'unreachable');
  down = false;
  await app.tick();
  assert.deepEqual(timers.delays, [45_000]);
  assert.equal(gladys.fake.transports.at(-1).transport, 'local');
});

test('arming from the mode select: the missing zones one by one, logged', async () => {
  const { panel, set, state, logger, events } = await setup();
  const ack = await set('alarm', 'mode', 'ab');
  assert.deepEqual(ack, { success: true });
  assert.deepEqual(panel.state.zones, { A: true, B: true, C: false });
  assert.deepEqual(
    panel.posted.map((form) => Object.keys(form).at(-1)),
    ['btn_zone_on_A', 'btn_zone_on_B'],
  );
  assert.equal(state('alarm', 'mode'), 'ab');
  assert.equal(state('alarm', 'zone-b'), 1);
  assert.ok(logger.lines.includes('info ARMING zone A from Gladys (mode ab)'));
  assert.ok(logger.lines.includes('info Panel: zone B ARMED (Gladys command)'));
  assert.deepEqual(events(), [
    { key: 'alarm_armed', data: { zone: 'A', zones: 'A B', by_gladys: true } },
    { key: 'alarm_armed', data: { zone: 'B', zones: 'A B', by_gladys: true } },
  ]);
  // Then total: only C is missing.
  await set('alarm', 'mode', 'abc');
  assert.deepEqual(Object.keys(panel.posted.at(-1)).at(-1), 'btn_zone_on_C');
  assert.equal(panel.session, undefined);
});

test('total arming from disarmed: the "A B C" button', async () => {
  const { panel, set } = await setup({ panel: new FakePanel({ model: 'protexiom' }) });
  await set('alarm', 'mode', 'abc');
  assert.deepEqual(panel.posted, [{ hidden: 'hidden', zone: 'Marche A B C' }]);
});

test('disarming is refused by default, before any login', async () => {
  const { app, panel, set, logger } = await setup();
  panel.state.zones.A = true;
  await app.tick();
  const logins = panel.logins;
  for (const [key, value] of [
    ['mode', 'off'],
    ['mode', 'b'],
    ['zone-a', 0],
  ]) {
    const ack = await set('alarm', key, value);
    assert.equal(ack.success, false, `${key}=${value}`);
    assert.match(ack.error, /Le désarmement depuis Gladys est désactivé/);
  }
  assert.equal(panel.logins, logins, 'no login for a refused command');
  assert.equal(panel.state.zones.A, true);
  assert.ok(logger.lines.some((line) => line.startsWith('warn Disarm REFUSED (mode off)')));
});

test('disarming when allowed: everything off, then the zones asked back on', async () => {
  const { app, panel, set, events, logger } = await setup({ config: { allow_disarm: true } });
  Object.assign(panel.state.zones, { A: true, B: true, C: true });
  await app.tick();
  await set('alarm', 'mode', 'a');
  assert.deepEqual(panel.state.zones, { A: true, B: false, C: false });
  assert.deepEqual(
    panel.posted.map((form) => Object.keys(form).at(-1)),
    ['btn_zone_off_ABC', 'btn_zone_on_A'],
  );
  assert.ok(logger.lines.includes('info DISARMING zones A B C from Gladys (mode a)'));
  assert.deepEqual(
    events().map((e) => `${e.key} ${e.data.zone} ${e.data.by_gladys}`),
    [
      'alarm_armed A false',
      'alarm_armed B false',
      'alarm_armed C false',
      'alarm_disarmed B true',
      'alarm_disarmed C true',
    ],
  );
  // A zone switch off disarms the three (the panel has no per-zone disarm).
  await set('alarm', 'zone-a', 0);
  assert.deepEqual(panel.state.zones, { A: false, B: false, C: false });
});

test('the zone switches, and a command that changes nothing', async () => {
  const { panel, set, state } = await setup({ panel: new FakePanel({ model: 'protexial_io' }) });
  await set('alarm', 'zone-c', 1);
  assert.deepEqual(panel.posted, [{ hidden: 'hidden', btn_zone_on_C: 'Marche C' }]);
  assert.equal(state('alarm', 'zone-c'), 1);
  assert.equal(state('alarm', 'mode'), 'c');
  await set('alarm', 'zone-c', 1);
  assert.equal(panel.posted.length, 1, 'already armed: nothing posted');
  await set('alarm', 'zone-a', 0);
  assert.equal(panel.posted.length, 1, 'already off: nothing posted, no permission needed');
});

test('arming can be disabled too', async () => {
  const { panel, set } = await setup({ config: { allow_arm: false } });
  const ack = await set('alarm', 'zone-a', 1);
  assert.equal(ack.success, false);
  assert.match(ack.error, /L'armement depuis Gladys est désactivé/);
  assert.equal(panel.posted.length, 0);
});

test('the read-only features and unknown values are refused', async () => {
  const { set } = await setup();
  assert.equal((await set('alarm', 'tamper', 1)).success, false);
  assert.equal((await set('alarm', 'mode', 'everything')).success, false);
  assert.equal((await set('shutters', 'shutters', 3)).success, false);
});

test('lights and shutters', async () => {
  const { panel, set, state } = await setup();
  assert.deepEqual(await set('lights', 'lights', 1), { success: true });
  assert.equal(panel.lights, 'ON');
  assert.equal(state('lights', 'lights'), 1);
  await set('lights', 'lights', 0);
  assert.equal(panel.lights, 'OFF');
  assert.equal(state('lights', 'lights'), 0);
  for (const [value, button] of [
    [-1, 'btn_vol_down'],
    [0, 'btn_vol_stop'],
    [1, 'btn_vol_up'],
  ]) {
    await set('shutters', 'shutters', value);
    assert.equal(panel.shutter.at(-1), button);
    assert.equal(state('shutters', 'shutters'), value);
  }
});

test('scene events from what the panel reports: keypad arming, intrusion, tamper, battery', async () => {
  const { app, panel, events, state, logger } = await setup();
  panel.state.zones.A = true;
  await app.tick();
  panel.state.faults.alarm = true;
  await app.tick();
  assert.equal(state('alarm', 'triggered'), 1);
  assert.equal(state('alarm', 'motion'), 1);
  Object.assign(panel.state.faults, { box: true, battery: true });
  await app.tick();
  await app.tick();
  assert.deepEqual(
    events().map((e) => [e.key, e.data]),
    [
      ['alarm_armed', { zone: 'A', zones: 'A', by_gladys: false }],
      ['alarm_triggered', { zones: 'A' }],
      ['intrusion_or_tamper', { kind: 'intrusion', armed: true }],
      ['intrusion_or_tamper', { kind: 'tamper', armed: true }],
      ['battery_low', {}],
    ],
  );
  assert.ok(logger.lines.includes('warn Panel: ALARM TRIGGERED (zones A)'));
  assert.ok(logger.lines.includes('info Panel: zone A ARMED (keypad, remote or app)'));
});

test('a refused card code warns, two in a row stop the logins until the configuration changes', async () => {
  const card = parseCard(CARD_TYPED)
    .text.replace(/B1=\d+/, 'B1=0000')
    .replace(/D3=\d+/, 'D3=0000');
  const { app, panel, gladys, timers } = await setup({ config: { auth_card: card } });
  assert.match(gladys.fake.connectionStatus.message.fr, /refusé le code de la case B1/);
  assert.equal(timers.pending.size, 1, 'still reading');
  await app.tick();
  assert.match(
    gladys.fake.connectionStatus.message.fr,
    /Arrêt après 2 codes de carte refusés \(cases B1, D3\)/,
  );
  assert.equal(timers.pending.size, 0, 'no next read');
  const logins = panel.logins;
  await app.tick();
  assert.equal(panel.logins, logins);
  assert.equal(panel.locked, false, 'stopped before the panel locked itself');
  // Commands are refused without trying.
  const device = gladys.fake.discoveredDevices[0];
  assert.equal(device, undefined, 'never read: no devices yet');
  // The card fixed: reads again.
  await gladys.fake.configUpdated({ ...CONFIG });
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(timers.pending.size, 1);
});

test('a refused user code stops at once; "Test the connection" retries', async () => {
  const panel = new FakePanel({ userCode: '5555' });
  const { app, gladys, timers } = await setup({ panel });
  assert.equal(panel.attempts, 1);
  assert.match(gladys.fake.connectionStatus.message.en, /refused the user access code: stopped/);
  assert.equal(timers.pending.size, 0);
  await app.tick();
  assert.equal(panel.attempts, 1, 'no second try by itself');
  const failed = await gladys.fake.action(ACTIONS.TEST_CONNECTION, {});
  assert.equal(failed.success, false);
  assert.equal(panel.attempts, 2);
  // The code changed on the panel side (or fixed in Gladys): the test button resumes.
  panel.userCode = '1234';
  const ok = await gladys.fake.action(ACTIONS.TEST_CONNECTION, {});
  assert.equal(ok.success, true);
  assert.match(
    ok.data.message.fr,
    /Connexion réussie : Protexial 2010 \(v8_1\), pages \/fr\/, aucune zone armée\. Carte : 30 codes\./,
  );
  assert.equal(timers.pending.size, 1, 'reads resumed');
});

test('another session open: skipped, then taken over after five reads in a row', async () => {
  const panel = new FakePanel();
  panel.otherSession = true;
  const { app, gladys } = await setup({ panel });
  assert.match(gladys.fake.connectionStatus.message.en, /Another session is open/);
  for (let i = 0; i < 4; i += 1) {
    await app.tick();
  }
  assert.equal(panel.otherSession, true, 'left alone for five reads');
  await app.tick();
  assert.equal(panel.otherSession, false, 'taken over at the sixth');
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('the card import in two clicks, reads paused in between', async () => {
  const panel = new FakePanel();
  const { app, gladys, timers } = await setup({ panel, config: { auth_card: '' } });
  assert.equal(panel.requests.length, 0);
  const first = await gladys.fake.action(ACTIONS.IMPORT_CARD, {});
  assert.equal(first.success, true);
  assert.match(first.data.message.fr, /La centrale demande la case B1 \(colonne B, ligne 1\)/);
  // The card is still empty: no read anyway; the import window pauses them too.
  const before = panel.requests.length;
  await app.tick();
  assert.equal(panel.requests.length, before);
  const second = await gladys.fake.action(ACTIONS.IMPORT_CARD, { cell_code: panel.card.B1 });
  assert.equal(second.success, true, second.error);
  assert.match(second.data.message.en, /Card imported: 30 codes/);
  assert.deepEqual(parseCard(gladys.fake.config.auth_card).codes, panel.card);
  assert.equal(gladys.fake.connectionStatus.connected, true, 'reads with the imported card');
  assert.equal(timers.pending.size, 1);
});

test('the card import: a wrong code, then the code after the window closed', async () => {
  const panel = new FakePanel();
  const { gladys, advance } = await setup({ panel, config: { auth_card: '' } });
  await gladys.fake.action(ACTIONS.IMPORT_CARD, {});
  const wrong = await gladys.fake.action(ACTIONS.IMPORT_CARD, { cell_code: '0000' });
  assert.equal(wrong.success, false);
  assert.match(wrong.error, /case B1/);
  await gladys.fake.action(ACTIONS.IMPORT_CARD, {});
  advance(6 * 60_000);
  const late = await gladys.fake.action(ACTIONS.IMPORT_CARD, { cell_code: panel.card.D3 });
  assert.equal(late.success, true);
  assert.match(late.data.message.en, /The panel asks for cell/, 'too late: asked again');
});

test('the card import of an ALT Protexiom asks for the administrator code', async () => {
  const panel = new FakePanel({ model: 'protexiom_alt' });
  const { gladys } = await setup({ panel, config: { auth_card: '' } });
  const first = await gladys.fake.action(ACTIONS.IMPORT_CARD, {});
  assert.match(first.data.message.en, /administrator access code/);
  const second = await gladys.fake.action(ACTIONS.IMPORT_CARD, {
    cell_code: panel.card.B1,
    admin_code: '9876',
  });
  assert.equal(second.success, true, second.error);
});

test('read now, clear the faults (button and scene action)', async () => {
  const { panel, gladys, state } = await setup();
  Object.assign(panel.state.faults, { alarm: true, battery: true, radio: true });
  const refreshed = await gladys.fake.action(ACTIONS.REFRESH, {});
  assert.equal(refreshed.success, true);
  assert.equal(state('alarm', 'battery-low'), 1);
  const cleared = await gladys.fake.action(ACTIONS.RESET_FAULTS, { fault: 'battery' });
  assert.equal(cleared.success, true);
  assert.equal(state('alarm', 'battery-low'), 0);
  assert.equal(state('alarm', 'motion'), 1);
  const scene = await gladys.fake.sceneAction(SCENE_ACTIONS.RESET_FAULTS, {});
  assert.equal(scene.success, true);
  assert.equal(state('alarm', 'motion'), 0);
  assert.equal(state('alarm', 'radio-link'), 1);
});

test('discovery and device creation resend what Gladys needs', async () => {
  const { gladys, deviceOf } = await setup();
  await gladys.fake.scanRequest();
  assert.equal(gladys.fake.discoveredDevices.length, 3);
  const count = gladys.fake.states.length;
  await gladys.fake.deviceCreated(deviceOf('alarm'));
  assert.ok(gladys.fake.states.length > count, 'the states of the new device are sent again');
});

test('a new language renames the devices; a new interval reschedules', async () => {
  const { gladys, timers } = await setup();
  await gladys.fake.configUpdated({ ...CONFIG, language: 'en', poll_interval_disarmed: 120 });
  assert.equal(gladys.fake.discoveredDevices[0].name, 'Somfy alarm');
  assert.deepEqual(timers.delays, [120_000]);
});

test('read now while another session is open: the reason, not an old state', async () => {
  const { panel, gladys } = await setup();
  panel.otherSession = true;
  const ack = await gladys.fake.action(ACTIONS.REFRESH, {});
  assert.equal(ack.success, false);
  assert.match(ack.error, /Une autre session est ouverte/);
});

test('a command the panel refuses fails alone: the panel stays reachable', async () => {
  const { panel, gladys, set } = await setup();
  panel.control = () => false; // answers (0x1003) to every control form
  const ack = await set('lights', 'lights', 1);
  assert.equal(ack.success, false);
  assert.match(ack.error, /did not understand the command/);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(gladys.fake.transports.at(-1).transport, 'local');
  assert.equal(panel.session, undefined, 'logged out');
});

test('"Test the connection" without user code or card', async () => {
  const noCard = await setup({ config: { auth_card: '' } });
  const found = await noCard.gladys.fake.action(ACTIONS.TEST_CONNECTION, {});
  assert.equal(found.success, true);
  assert.match(
    found.data.message.en,
    /Panel found: Protexial 2010 \(v8_1\), pages \/fr\/\. Import or type the card/,
  );
  const noCode = await setup({ config: { user_code: '' } });
  const refused = await noCode.gladys.fake.action(ACTIONS.TEST_CONNECTION, {});
  assert.equal(refused.success, false);
  assert.match(refused.error, /code d'accès utilisateur/);
});

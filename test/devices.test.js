import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { MODES } from '../src/constants.js';
import {
  alarmFeatureKeys,
  alarmStates,
  buildDevices,
  modeOf,
  parseFeatureId,
  shutterForm,
  zonesOf,
} from '../src/devices.js';
import { MODELS } from '../src/models.js';
import { parseStatus } from '../src/parse.js';
import { statusXml } from './fixtures/pages.js';

const STATE = {
  zones: { A: true, B: false, C: true },
  faults: { battery: true, radio: false, door: true, alarm: true, box: false },
  gsm: true,
  signal: 3,
  operator: 'SFR',
  camera: false,
};
const DETECTED = { model: MODELS.protexial, year: '2010', version: 'v8_1', prefix: 'fr' };
const id = (device, key) => `ext:test-integration:${device}:panel${key ? `:${key}` : ''}`;
const stateOf = (states, key) =>
  states.find((s) => s.device_feature_external_id === id('alarm', key));

test('modes and zones, both ways', () => {
  assert.equal(modeOf([]), 'off');
  assert.equal(modeOf(['A', 'C']), 'ac');
  assert.equal(modeOf(['A', 'B', 'C']), 'abc');
  for (const mode of MODES) {
    assert.equal(modeOf(zonesOf(mode)), mode);
  }
  assert.deepEqual(zonesOf('BC'), ['B', 'C']);
  assert.equal(zonesOf('ca'), undefined, 'only the declared values');
  assert.equal(zonesOf('armed'), undefined);
});

test('the three devices, accepted by the fake Gladys (categories, types, units)', async () => {
  const gladys = createFakeGladys();
  await gladys.connect();
  const status = parseStatus(statusXml(STATE));
  const devices = buildDevices(gladys, status, DETECTED, 'fr');
  await gladys.publishDiscoveredDevices(devices);
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((d) => [d.external_id, d.name]),
    [
      [id('alarm'), 'Alarme Somfy'],
      [id('shutters'), 'Volets Somfy'],
      [id('lights'), 'Lumières Somfy'],
    ],
  );
  const [alarm, shutters, lights] = devices;
  assert.deepEqual(
    alarm.features.map((f) => f.external_id.split(':').pop()),
    alarmFeatureKeys(status),
  );
  assert.ok(alarm.features.some((f) => f.external_id === id('alarm', 'camera-link')));
  const mode = alarm.features[0];
  assert.equal(mode.read_only, false);
  assert.deepEqual(
    mode.supported_options.map((o) => o.value),
    MODES,
  );
  assert.equal(mode.supported_options.at(-1).label, 'Totale (A + B + C)');
  assert.deepEqual(alarm.params, [
    { name: 'model', value: 'Protexial' },
    { name: 'year', value: '2010' },
    { name: 'firmware', value: 'v8_1' },
  ]);
  assert.deepEqual(
    [
      shutters.features[0].category,
      shutters.features[0].type,
      shutters.features[0].min,
      shutters.features[0].max,
    ],
    ['shutter', 'state', -1, 1],
  );
  assert.equal(lights.features[0].read_only, false);
  const english = buildDevices(gladys, status, DETECTED, 'en');
  assert.equal(english[0].name, 'Somfy alarm');
  assert.equal(english[0].features[0].supported_options[0].label, 'Disarmed');
});

test('optional features only when the panel reports them', () => {
  const status = parseStatus(statusXml({ ...STATE, gsm: null, camera: null }));
  const keys = alarmFeatureKeys(status);
  assert.ok(
    !keys.includes('gsm-link') && !keys.includes('gsm-signal') && !keys.includes('camera-link'),
  );
  assert.equal(keys.length, 10);
  assert.equal(alarmFeatureKeys(undefined).length, 10);
});

test('the states of a status, with the Gladys values', async () => {
  const gladys = createFakeGladys();
  await gladys.connect();
  const states = alarmStates(gladys, parseStatus(statusXml(STATE)));
  const value = (key) => stateOf(states, key)?.state ?? stateOf(states, key)?.text;
  assert.equal(value('mode'), 'ac');
  assert.deepEqual(['zone-a', 'zone-b', 'zone-c'].map(value), [1, 0, 1]);
  assert.equal(value('triggered'), 1, 'intrusion while armed');
  assert.equal(value('motion'), 1);
  assert.equal(value('opening'), 0, 'opening-sensor: 0 = open');
  assert.equal(value('tamper'), 0);
  assert.equal(value('battery-low'), 1);
  assert.equal(value('radio-link'), 1, 'link OK');
  assert.equal(value('gsm-link'), 1);
  assert.equal(value('gsm-signal'), 3);
  assert.equal(value('gsm-operator'), 'SFR');
  assert.equal(value('camera-link'), 0);
  // Gladys accepts them all.
  const result = await gladys.publishStates(states);
  assert.ok(result);
  // Intrusion flag while disarmed: not "triggered".
  const disarmed = alarmStates(
    gladys,
    parseStatus(statusXml({ ...STATE, zones: { A: false, B: false, C: false } })),
  );
  assert.equal(stateOf(disarmed, 'triggered').state, 0);
  assert.equal(stateOf(disarmed, 'mode').text, 'off');
});

test('feature ids and shutter commands', () => {
  assert.deepEqual(parseFeatureId(id('alarm', 'zone-b')), { device: 'alarm', key: 'zone-b' });
  assert.deepEqual(parseFeatureId(id('shutters', 'shutters')), {
    device: 'shutters',
    key: 'shutters',
  });
  assert.equal(parseFeatureId('ext:test-integration:other:1:x'), undefined);
  const model = MODELS.protexiom;
  assert.equal(shutterForm(model, 1), model.forms.shutterOpen);
  assert.equal(shutterForm(model, -1), model.forms.shutterClose);
  assert.equal(shutterForm(model, 0), model.forms.shutterStop);
  assert.equal(shutterForm(model, 2), undefined);
});

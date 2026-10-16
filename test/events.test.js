import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTriggered, statusEvents } from '../src/events.js';
import { parseStatus } from '../src/parse.js';
import { statusXml } from './fixtures/pages.js';

const base = {
  zones: { A: false, B: false, C: false },
  faults: { battery: false, radio: false, door: false, alarm: false, box: false },
  gsm: true,
  signal: 4,
  operator: 'Orange F',
  camera: null,
};
const status = (changes = {}) =>
  parseStatus(
    statusXml({
      ...base,
      zones: { ...base.zones, ...changes.zones },
      faults: { ...base.faults, ...changes.faults },
    }),
  );

test('no event on the first reading, nor around an empty status.xml', () => {
  assert.deepEqual(statusEvents(undefined, status({ zones: { A: true } })), []);
  const empty = parseStatus(statusXml(base, { empty: true }));
  assert.deepEqual(statusEvents(empty, status({ zones: { A: true } })), []);
  assert.deepEqual(statusEvents(status(), empty), []);
  assert.deepEqual(statusEvents(status(), status()), []);
});

test('armed and disarmed, one event per zone', () => {
  const armed = statusEvents(status(), status({ zones: { A: true, C: true } }), {
    byGladys: (zone) => zone === 'A',
  });
  assert.deepEqual(armed, [
    { key: 'alarm_armed', data: { zone: 'A', zones: 'A C', by_gladys: true } },
    { key: 'alarm_armed', data: { zone: 'C', zones: 'A C', by_gladys: false } },
  ]);
  const disarmed = statusEvents(status({ zones: { A: true, B: true } }), status());
  assert.deepEqual(disarmed, [
    { key: 'alarm_disarmed', data: { zone: 'A', zones: '', by_gladys: false } },
    { key: 'alarm_disarmed', data: { zone: 'B', zones: '', by_gladys: false } },
  ]);
});

test('an intrusion while armed: triggered and intrusion, once', () => {
  const armed = status({ zones: { A: true, B: true, C: true } });
  const intrusion = status({ zones: { A: true, B: true, C: true }, faults: { alarm: true } });
  assert.deepEqual(statusEvents(armed, intrusion), [
    { key: 'alarm_triggered', data: { zones: 'A B C' } },
    { key: 'intrusion_or_tamper', data: { kind: 'intrusion', armed: true } },
  ]);
  assert.deepEqual(statusEvents(intrusion, intrusion), [], 'latched flag: no repeat');
});

test('an intrusion while disarmed, a tamper, a low battery', () => {
  const events = statusEvents(
    status(),
    status({ faults: { alarm: true, box: true, battery: true } }),
  );
  assert.deepEqual(events, [
    { key: 'intrusion_or_tamper', data: { kind: 'intrusion', armed: false } },
    { key: 'intrusion_or_tamper', data: { kind: 'tamper', armed: false } },
    { key: 'battery_low', data: {} },
  ]);
});

test('a flag latched before arming is not a trigger; one between the two readings is', () => {
  const latched = status({ faults: { alarm: true } });
  const armedLatched = status({ zones: { B: true }, faults: { alarm: true } });
  assert.deepEqual(statusEvents(latched, armedLatched), [
    { key: 'alarm_armed', data: { zone: 'B', zones: 'B', by_gladys: false } },
  ]);
  assert.equal(isTriggered(latched, armedLatched, false), false);
  assert.equal(isTriggered(armedLatched, armedLatched, true), true, 'kept while armed');
  assert.equal(isTriggered(armedLatched, latched, true), false, 'disarmed: over');
  assert.equal(isTriggered(undefined, armedLatched), true, 'first reading: as the reference');
  // Armed and intruded between two readings.
  const quiet = status();
  assert.deepEqual(
    statusEvents(quiet, armedLatched).map((e) => e.key),
    ['alarm_armed', 'alarm_triggered', 'intrusion_or_tamper'],
  );
});

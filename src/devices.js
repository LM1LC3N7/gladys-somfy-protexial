// -----------------------------------------------------------------------------
// The panel -> Gladys devices, and their states (pure).
//
// One panel per integration, three devices, ids that do not depend on the
// panel address (a new DHCP lease keeps the devices):
// - `ext:<selector>:alarm:panel`: alarm mode select, one switch per zone,
//   alarm triggered, intrusion, doors and windows, tamper, batteries, radio
//   link, and GSM / camera when the panel reports them;
// - `ext:<selector>:shutters:panel`: the shutters of the panel (open, close,
//   stop; no position, the panel has none);
// - `ext:<selector>:lights:panel`: the lights of the panel (on / off; the
//   panel does not report them, the state is the last command).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
} from '@gladysassistant/integration-sdk';
import { COVER_STATE, MODES, OPENING_SENSOR_STATE, ZONES } from './constants.js';
import { DEVICE_NAMES, FEATURE_NAMES, MODE_NAMES, word } from './i18n.js';
import { armedZones } from './parse.js';

const binary = (category, type, extra = {}) => ({ category, type, min: 0, max: 1, ...extra });

/** The features, by key (the last part of their external id). Keys are forever. */
export const FEATURES = {
  mode: {
    category: C.TEXT,
    type: T.TEXT.SELECT,
    min: 0,
    max: 0,
    read_only: false,
    has_feedback: true,
    keep_history: false,
  },
  'zone-a': binary(C.SWITCH, T.SWITCH.BINARY, { read_only: false, has_feedback: true }),
  'zone-b': binary(C.SWITCH, T.SWITCH.BINARY, { read_only: false, has_feedback: true }),
  'zone-c': binary(C.SWITCH, T.SWITCH.BINARY, { read_only: false, has_feedback: true }),
  triggered: binary(C.SIREN, T.SIREN.BINARY),
  motion: binary(C.MOTION_SENSOR, T.SENSOR.BINARY),
  opening: binary(C.OPENING_SENSOR, T.SENSOR.BINARY),
  tamper: binary(C.TAMPER, T.TAMPER.BINARY),
  'battery-low': binary(C.BATTERY_LOW, T.BATTERY_LOW.BINARY),
  'radio-link': binary(C.INPUT, T.INPUT.BINARY),
  'gsm-link': binary(C.INPUT, T.INPUT.BINARY),
  'gsm-signal': { category: C.SIGNAL, type: T.SIGNAL.QUALITY, min: 0, max: 5 },
  'gsm-operator': { category: C.TEXT, type: T.TEXT.TEXT, min: 0, max: 0, keep_history: false },
  'camera-link': binary(C.INPUT, T.INPUT.BINARY),
  shutters: {
    category: C.SHUTTER,
    type: T.SHUTTER.STATE,
    min: -1,
    max: 1,
    read_only: false,
    has_feedback: false,
    keep_history: false,
  },
  lights: binary(C.LIGHT, T.LIGHT.BINARY, { read_only: false, has_feedback: false }),
};

export const ZONE_FEATURES = { A: 'zone-a', B: 'zone-b', C: 'zone-c' };

export const deviceIds = (gladys) => ({
  alarm: gladys.externalIds('alarm', 'panel'),
  shutters: gladys.externalIds('shutters', 'panel'),
  lights: gladys.externalIds('lights', 'panel'),
});

/** `ext:sel:alarm:panel:zone-a` -> { device: 'alarm', key: 'zone-a' }. */
export function parseFeatureId(externalId) {
  const match = /:(alarm|shutters|lights):panel:([^:]+)$/.exec(String(externalId ?? ''));
  return match ? { device: match[1], key: match[2] } : undefined;
}

/** ['A', 'B'] -> 'ab', [] -> 'off'. */
export const modeOf = (zones) => (zones.length === 0 ? 'off' : zones.join('').toLowerCase());

/** 'ab' -> ['A', 'B'], 'off' -> []; undefined for an unknown value. */
export function zonesOf(mode) {
  const value = String(mode ?? '').toLowerCase();
  if (!MODES.includes(value)) {
    return undefined;
  }
  return value === 'off' ? [] : ZONES.filter((zone) => value.includes(zone.toLowerCase()));
}

function feature(ids, key, language, extra = {}) {
  return {
    name: word(FEATURE_NAMES[key], language),
    external_id: ids.feature(key),
    read_only: true,
    has_feedback: false,
    keep_history: true,
    ...FEATURES[key],
    ...extra,
  };
}

const params = (entries) =>
  entries
    .filter(([, value]) => value !== undefined && value !== null && String(value) !== '')
    .map(([name, value]) => ({ name, value: String(value) }));

/** The keys of the alarm device: the optional ones only when the panel reports them. */
export function alarmFeatureKeys(status) {
  const keys = [
    'mode',
    'zone-a',
    'zone-b',
    'zone-c',
    'triggered',
    'motion',
    'opening',
    'tamper',
    'battery-low',
    'radio-link',
  ];
  if (status?.gsm !== undefined) keys.push('gsm-link');
  if (status?.signal !== undefined) keys.push('gsm-signal');
  if (status?.operator !== undefined) keys.push('gsm-operator');
  if (status?.camera !== undefined) keys.push('camera-link');
  return keys;
}

/**
 * @param {object} gladys the SDK client (externalIds)
 * @param {object|undefined} status the last parseStatus result
 * @param {object|undefined} detected PanelClient.detected
 */
export function buildDevices(gladys, status, detected, language) {
  const ids = deviceIds(gladys);
  const info = params([
    ['model', detected?.model.name],
    ['year', detected?.year],
    ['firmware', detected?.version],
  ]);
  const modeOptions = MODES.map((value) => ({ value, label: word(MODE_NAMES[value], language) }));
  return [
    {
      name: word(DEVICE_NAMES.alarm, language),
      external_id: ids.alarm.device,
      should_poll: false,
      params: info,
      features: alarmFeatureKeys(status).map((key) =>
        feature(ids.alarm, key, language, key === 'mode' ? { supported_options: modeOptions } : {}),
      ),
    },
    {
      name: word(DEVICE_NAMES.shutters, language),
      external_id: ids.shutters.device,
      should_poll: false,
      params: info,
      features: [feature(ids.shutters, 'shutters', language)],
    },
    {
      name: word(DEVICE_NAMES.lights, language),
      external_id: ids.lights.device,
      should_poll: false,
      params: info,
      features: [feature(ids.lights, 'lights', language)],
    },
  ];
}

/**
 * The current states of the alarm device: `[{ device_feature_external_id, state | text }]`.
 * `triggered` comes from events.isTriggered (it needs the previous reading).
 */
export function alarmStates(gladys, status, { triggered } = {}) {
  const ids = deviceIds(gladys).alarm;
  const states = [];
  const push = (key, value) => {
    if (value !== undefined) {
      states.push({
        device_feature_external_id: ids.feature(key),
        ...(typeof value === 'object' ? value : { state: value }),
      });
    }
  };
  const flag = (value, onFault = 1) =>
    value === undefined ? undefined : value ? onFault : 1 - onFault;
  const zones = armedZones(status);
  push('mode', { text: modeOf(zones) });
  for (const zone of ZONES) {
    push(ZONE_FEATURES[zone], status.zones[zone] ? 1 : 0);
  }
  // Without the previous reading, the reference's rule: an intrusion flag while armed.
  const isTriggered = triggered ?? (status.alarm === true && zones.length > 0);
  push('triggered', status.alarm === undefined ? undefined : isTriggered ? 1 : 0);
  push('motion', flag(status.alarm));
  push(
    'opening',
    status.door === undefined
      ? undefined
      : status.door
        ? OPENING_SENSOR_STATE.OPEN
        : OPENING_SENSOR_STATE.CLOSE,
  );
  push('tamper', flag(status.box));
  push('battery-low', flag(status.battery));
  push('radio-link', flag(status.radio, 0));
  if (status.gsm !== undefined) push('gsm-link', status.gsm.connected ? 1 : 0);
  push('gsm-signal', status.signal);
  if (status.operator !== undefined) push('gsm-operator', { text: status.operator });
  if (status.camera !== undefined) push('camera-link', status.camera ? 1 : 0);
  return states;
}

/** Gladys shutter value -> the form to post: 1 open, -1 close, 0 stop. */
export function shutterForm(model, value) {
  if (value === COVER_STATE.OPEN) return model.forms.shutterOpen;
  if (value === COVER_STATE.CLOSE) return model.forms.shutterClose;
  if (value === COVER_STATE.STOP) return model.forms.shutterStop;
  return undefined;
}

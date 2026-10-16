// -----------------------------------------------------------------------------
// Two readings of the panel -> scene events (pure). Only transitions fire:
// the first reading after a start is history. The panel latches its fault
// flags (intrusion, batteries, radio) until they are cleared, so each one
// fires once, when it appears.
// -----------------------------------------------------------------------------

import { SCENE_TRIGGERS, ZONES } from './constants.js';
import { armedZones } from './parse.js';

const list = (zones) => zones.join(' ');

/**
 * Whether the alarm is triggered: an intrusion flag while a zone is armed
 * (the reference's TRIGGERED state), but not a flag latched BEFORE arming
 * (an old detection nobody cleared): only one that appears while armed, or
 * between the two readings that saw the arming.
 */
export function isTriggered(previous, next, wasTriggered = false) {
  if (next.alarm !== true || armedZones(next).length === 0) {
    return false;
  }
  if (!previous || previous.empty) {
    return previous ? wasTriggered : true;
  }
  return previous.alarm === false ? true : wasTriggered;
}

/**
 * @param {object|undefined} previous parseStatus result
 * @param {object} next parseStatus result
 * @param {object} options
 * @param {(zone: string, armed: boolean) => boolean} [options.byGladys] a Gladys command asked for it
 * @param {boolean} [options.wasTriggered] isTriggered of the previous reading
 * @returns {{ key: string, data: object }[]}
 */
export function statusEvents(
  previous,
  next,
  { byGladys = () => false, wasTriggered = false } = {},
) {
  if (!previous || previous.empty || next.empty) {
    return [];
  }
  const events = [];
  const zones = armedZones(next);
  for (const zone of ZONES) {
    const before = previous.zones[zone];
    const after = next.zones[zone];
    if (before === after) {
      continue;
    }
    events.push({
      key: after ? SCENE_TRIGGERS.ALARM_ARMED : SCENE_TRIGGERS.ALARM_DISARMED,
      data: { zone, zones: list(zones), by_gladys: byGladys(zone, after) },
    });
  }
  if (isTriggered(previous, next, wasTriggered) && !wasTriggered) {
    events.push({ key: SCENE_TRIGGERS.ALARM_TRIGGERED, data: { zones: list(zones) } });
  }
  if (next.alarm === true && previous.alarm === false) {
    events.push({
      key: SCENE_TRIGGERS.INTRUSION_OR_TAMPER,
      data: { kind: 'intrusion', armed: zones.length > 0 },
    });
  }
  if (next.box === true && previous.box === false) {
    events.push({
      key: SCENE_TRIGGERS.INTRUSION_OR_TAMPER,
      data: { kind: 'tamper', armed: zones.length > 0 },
    });
  }
  if (next.battery === true && previous.battery === false) {
    events.push({ key: SCENE_TRIGGERS.BATTERY_LOW, data: {} });
  }
  return events;
}

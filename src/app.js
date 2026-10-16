// -----------------------------------------------------------------------------
// The integration: the panel address, user code and authentication card, a
// read of status.xml at each poll (one login / read / logout session), the
// three Gladys devices and their states, the alarm, shutter and light
// commands, the scene events, the card import and the configuration buttons.
// index.js only wires the SDK handlers to it.
//
// Safety: disarming from Gladys is off unless the configuration allows it,
// every arm and disarm is logged, and the integration stops logging in after
// refused codes rather than locking the panel.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { formatCard, parseCard } from './card.js';
import { normalizeConfig, sessionKey } from './config.js';
import { COVER_STATE, FAULTS, LIMITS, TIMINGS, ZONES } from './constants.js';
import {
  ZONE_FEATURES,
  alarmStates,
  buildDevices,
  deviceIds,
  parseFeatureId,
  shutterForm,
  zonesOf,
} from './devices.js';
import { isTriggered, statusEvents } from './events.js';
import { T, duration, word } from './i18n.js';
import { PanelError } from './http.js';
import { PanelClient } from './panel.js';
import { armedZones } from './parse.js';

/** A command Gladys asked for and the configuration refuses: nothing was sent. */
class Refused extends Error {}

/** Login refusals that stop the integration until the configuration changes. */
const STOPPING = new Set(['wrong_credentials', 'max_attempts']);
/** The panel refused a command after a good login: the panel itself is fine. */
const COMMAND_REFUSED = new Set(['unknown_parameter', 'bad_parameter']);
/** Errors meaning the panel did not answer usefully: the devices are unreachable. */
const OFFLINE = new Set(['network', 'timeout', 'http', 'size', 'unavailable', 'not_detected']);

export class ProtexialApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'somfy-protexial' }),
    transport,
    now = Date.now,
    timers = globalThis,
    sleep,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.timers = timers;
    this.panel = new PanelClient({ transport, sleep, logger });
    this.config = normalizeConfig();
    this.key = undefined;
    /** Successful reads since the start (the refresh button checks one happened). */
    this.reads = 0;
    /** The last status read (parseStatus), undefined before the first one. */
    this.status = undefined;
    /** events.isTriggered of the last reading. */
    this.triggered = false;
    /** Last light command (1/0): the panel does not report the lights. */
    this.lights = undefined;
    this.timer = undefined;
    this.generation = 0;
    /** One panel session at a time (polls, commands, actions). */
    this.lock = Promise.resolve();
    this.running = undefined;
    /** Cells whose code the panel refused in a row; `stopped` holds why logins stopped. */
    this.refusedCells = [];
    this.stopped = undefined;
    this.busy = 0;
    this.failures = 0;
    /** Step 1 of the card import: { cell, browser, model, until }. */
    this.pendingImport = undefined;
    /** zone -> { armed, until }: what the last Gladys command asked. */
    this.commanded = new Map();
    this.published = undefined;
    this.lastStatus = undefined;
    this.lastTransport = undefined;
    this.started = false;
  }

  get language() {
    return this.config.language;
  }

  error(message, cause) {
    return new Error(word(message, this.language), cause ? { cause } : undefined);
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(raw = {}) {
    this.stop();
    await this.running;
    this.config = normalizeConfig(raw);
    this.key = sessionKey(this.config);
    this.panel.configure(this.config);
    this.status = undefined;
    this.triggered = false;
    this.refusedCells = [];
    this.stopped = undefined;
    this.busy = 0;
    this.failures = 0;
    this.pendingImport = undefined;
    this.published = undefined;
    const problem = this.configProblem();
    if (problem) {
      await this.setStatus(false, problem);
      return;
    }
    await this.setStatus(false, T.connecting);
    await this.tick();
  }

  stop() {
    this.generation += 1;
    this.cancelTimer();
  }

  cancelTimer() {
    if (this.timer) {
      this.timers.clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  /** What keeps the integration from reading the panel, as a status message. */
  configProblem() {
    if (!this.config.url) return T.noUrl;
    if (!this.config.userCode) return T.noCode;
    if (this.config.card.problem === 'empty') return T.noCard;
    if (this.config.card.problem === 'count') return T.badCard(this.config.card.count);
    return undefined;
  }

  /**
   * Connected to Gladys. The first time, start; after a reconnection (Gladys
   * restarted), resend what Gladys keeps in memory only.
   */
  async connected(raw = {}) {
    if (!this.started) {
      this.started = true;
      await this.start(raw);
      return;
    }
    await this.configUpdated(raw);
    this.published = undefined;
    this.lastTransport = undefined;
    const status = this.lastStatus;
    this.lastStatus = undefined;
    if (status) {
      const [connected, message] = JSON.parse(status);
      await this.setStatus(connected, message ?? undefined);
    }
    await this.publishDevices();
    await this.publishCurrentStates();
  }

  /** A new address, code, card or model restarts; the rest applies at once. */
  async configUpdated(raw = {}) {
    const next = normalizeConfig(raw);
    if (sessionKey(next) !== this.key) {
      return this.start(raw);
    }
    const previous = this.config;
    this.config = next;
    if (next.language !== previous.language) {
      await this.publishDevices();
    }
    if (
      (next.pollArmed !== previous.pollArmed || next.pollDisarmed !== previous.pollDisarmed) &&
      this.timer
    ) {
      this.schedule();
    }
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  // --- Polling ---------------------------------------------------------------

  /** One panel operation at a time: the panel accepts a single session. */
  exclusive(fn) {
    const run = this.lock.then(fn);
    this.lock = run.catch(() => undefined);
    return run;
  }

  /** The next read: faster while armed, slower after errors. */
  delay() {
    const armed = armedZones(this.status).length > 0;
    const base = (armed ? this.config.pollArmed : this.config.pollDisarmed) * 1000;
    if (this.failures === 0) {
      return base;
    }
    return Math.max(base, TIMINGS.backoff[Math.min(this.failures - 1, TIMINGS.backoff.length - 1)]);
  }

  schedule() {
    if (this.timer) {
      this.timers.clearTimeout(this.timer);
    }
    const generation = this.generation;
    this.timer = this.timers.setTimeout(() => {
      this.timer = undefined;
      if (generation === this.generation) {
        this.tick().catch((err) => this.logger.error(`Panel read failed: ${err.message}`));
      }
    }, this.delay());
  }

  /** A read now (a tick during a read joins it), then the next one scheduled. */
  tick() {
    if (!this.running) {
      const generation = this.generation;
      this.running = this.poll()
        .finally(() => {
          this.running = undefined;
        })
        .then(() => {
          if (generation !== this.generation) {
            return;
          }
          if (this.stopped || this.configProblem()) {
            this.cancelTimer();
          } else {
            this.schedule();
          }
        });
    }
    return this.running;
  }

  async poll() {
    if (this.configProblem() || this.stopped) {
      return;
    }
    if (this.pendingImport && this.now() < this.pendingImport.until) {
      return;
    }
    this.pendingImport = undefined;
    const generation = this.generation;
    try {
      const status = await this.exclusive(() =>
        this.panel.readStatus({ takeOver: this.busy >= LIMITS.busyBeforeReset }),
      );
      if (generation === this.generation) {
        await this.apply(status);
      }
    } catch (err) {
      if (generation === this.generation) {
        await this.failed(err);
      }
    }
  }

  /** A session went through: forget the errors, publish the status and its events. */
  async apply(status) {
    this.refusedCells = [];
    this.busy = 0;
    this.failures = 0;
    if (status.empty) {
      // Known firmware bug (empty status.xml): keep the previous reading.
      this.logger.warn('The panel answered an empty status.xml: kept the previous reading');
      return;
    }
    const previous = this.status;
    const wasTriggered = this.triggered;
    const triggered = isTriggered(previous, status, wasTriggered);
    this.logTransitions(previous, status, triggered && !wasTriggered);
    this.status = status;
    this.reads += 1;
    this.triggered = triggered;
    await this.publishDevices();
    await this.publishCurrentStates();
    const events = statusEvents(previous, status, {
      byGladys: (zone, armed) => this.byGladys(zone, armed),
      wasTriggered,
    });
    for (const { key, data } of events) {
      await this.gladys
        .publishSceneEvent(key, data)
        .catch((err) => this.logger.warn(`Scene event ${key} refused: ${err.message}`));
    }
    await this.setStatus(true, T.connected(this.panel.detected, armedZones(status)));
    await this.publishTransports(DEVICE_TRANSPORTS.LOCAL);
  }

  byGladys(zone, armed) {
    const asked = this.commanded.get(zone);
    return Boolean(asked && asked.armed === armed && this.now() < asked.until);
  }

  logTransitions(previous, status, newlyTriggered) {
    for (const zone of ZONES) {
      if (previous && previous.zones[zone] !== status.zones[zone]) {
        const armed = status.zones[zone];
        const origin = this.byGladys(zone, armed) ? 'Gladys command' : 'keypad, remote or app';
        this.logger.info(`Panel: zone ${zone} ${armed ? 'ARMED' : 'DISARMED'} (${origin})`);
      }
    }
    if (newlyTriggered) {
      this.logger.warn(`Panel: ALARM TRIGGERED (zones ${armedZones(status).join(' ')})`);
    }
  }

  async failed(err) {
    const kind = err.kind ?? 'unexpected';
    if (COMMAND_REFUSED.has(kind)) {
      this.logger.warn(`The panel refused a command: ${err.message}`);
      return;
    }
    if (STOPPING.has(kind)) {
      this.stopped = kind === 'max_attempts' ? T.stoppedLocked : T.stoppedUserCode;
      this.logger.error(
        `Panel login refused (${err.message}): logins stopped until the configuration changes`,
      );
      await this.setStatus(false, this.stopped);
      await this.publishTransports(DEVICE_TRANSPORTS.UNREACHABLE);
      return;
    }
    if (kind === 'wrong_code') {
      this.refusedCells.push(err.cell);
      if (this.refusedCells.length >= LIMITS.maxRefusals) {
        this.stopped = T.stoppedCode(this.refusedCells);
        this.logger.error(
          `Panel refused the card codes of cells ${this.refusedCells.join(', ')}: logins stopped until the configuration changes`,
        );
        await this.setStatus(false, this.stopped);
        await this.publishTransports(DEVICE_TRANSPORTS.UNREACHABLE);
      } else {
        this.logger.warn(`Panel refused the card code of cell ${err.cell}`);
        await this.setStatus(false, T.wrongCode(this.refusedCells));
      }
      return;
    }
    if (kind === 'card_missing') {
      this.logger.warn(`The card has no code for cell ${err.cell}: no login attempted`);
      await this.setStatus(false, T.cardMissing(err.cell));
      return;
    }
    if (kind === 'busy') {
      this.busy += 1;
      this.logger.info(
        `Another session is open on the panel (${this.busy} in a row): next try at the next read`,
      );
      await this.setStatus(true, T.busy);
      return;
    }
    this.failures += 1;
    const wait = this.delay();
    this.logger.warn(`Panel: ${err.message} (${kind}); next try in ${Math.round(wait / 1000)} s`);
    await this.setStatus(
      false,
      kind === 'not_detected' ? T.notDetected : T.unreachable(err.message, duration(wait)),
    );
    if (OFFLINE.has(kind)) {
      await this.publishTransports(DEVICE_TRANSPORTS.UNREACHABLE);
    }
  }

  // --- Gladys ----------------------------------------------------------------

  async publishDevices({ force = false } = {}) {
    if (!this.status && !force) {
      return;
    }
    const devices = buildDevices(this.gladys, this.status, this.panel.detected, this.language);
    const json = JSON.stringify(devices);
    if (json === this.published && !force) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.published = json;
    } catch (err) {
      this.logger.warn(`Publishing the devices failed: ${err.message}`);
    }
  }

  async publishCurrentStates() {
    const states = this.status
      ? alarmStates(this.gladys, this.status, { triggered: this.triggered })
      : [];
    if (this.lights !== undefined) {
      states.push({
        device_feature_external_id: deviceIds(this.gladys).lights.feature('lights'),
        state: this.lights,
      });
    }
    if (states.length === 0) {
      return;
    }
    await this.gladys
      .publishChangedStates(states, { heartbeat: TIMINGS.stateHeartbeat })
      .catch((err) => this.logger.warn(`Publishing the states failed: ${err.message}`));
  }

  async publishTransports(transport) {
    if (!this.published || transport === this.lastTransport) {
      return;
    }
    const ids = deviceIds(this.gladys);
    try {
      await this.gladys.publishTransports(
        [ids.alarm, ids.shutters, ids.lights].map(({ device }) => ({
          external_id: device,
          transport,
        })),
      );
      this.lastTransport = transport;
    } catch (err) {
      this.logger.warn(`Publishing the transports failed: ${err.message}`);
    }
  }

  /** Discovery: read the panel first when it was never read. */
  async scan() {
    if (!this.status && !this.configProblem() && !this.stopped) {
      await this.tick();
    }
    await this.publishDevices({ force: true });
  }

  /** The user created or updated a device: the SDK forgot its states, send them again. */
  async deviceChanged() {
    await this.publishCurrentStates();
  }

  // --- Commands --------------------------------------------------------------

  ensureReady() {
    const problem = this.configProblem();
    if (problem) throw this.error(problem);
    if (this.stopped) throw this.error(T.stopped);
  }

  async setValue(_device, feature, value) {
    const target = parseFeatureId(feature?.external_id);
    if (!target) {
      throw new Error(`Unknown feature ${feature?.external_id}`);
    }
    this.ensureReady();
    if (target.device === 'alarm' && target.key === 'mode') {
      const zones = zonesOf(value);
      if (!zones) throw new Error(`Unknown alarm mode ${value}`);
      return this.setZones(zones, `mode ${value}`);
    }
    if (target.device === 'alarm') {
      const zone = Object.keys(ZONE_FEATURES).find((z) => ZONE_FEATURES[z] === target.key);
      if (!zone) throw new Error(`${target.key} is read-only`);
      return this.setZone(zone, Number(value) === 1);
    }
    if (target.device === 'shutters') {
      const command = Number(value);
      if (![COVER_STATE.OPEN, COVER_STATE.CLOSE, COVER_STATE.STOP].includes(command)) {
        throw new Error(`Unknown shutter command ${value}`);
      }
      await this.command(({ model }) => [shutterForm(model, command)]);
      const name = {
        [COVER_STATE.OPEN]: 'open',
        [COVER_STATE.CLOSE]: 'close',
        [COVER_STATE.STOP]: 'stop',
      };
      this.logger.info(`Shutters: ${name[command]} sent`);
      await this.gladys
        .publishState(deviceIds(this.gladys).shutters.feature('shutters'), command)
        .catch((err) => this.logger.warn(`Publishing the shutter state failed: ${err.message}`));
      return undefined;
    }
    const on = Number(value) === 1;
    await this.command(({ model }) => [on ? model.forms.lightOn : model.forms.lightOff]);
    this.logger.info(`Lights: ${on ? 'on' : 'off'} sent`);
    this.lights = on ? 1 : 0;
    await this.publishCurrentStates();
    return undefined;
  }

  /** The zones armed must become exactly `target`. */
  setZones(target, what) {
    // Refused before any login when the last reading already says so.
    if (this.status) this.planZones(armedZones(this.status), target, what, { dryRun: true });
    return this.alarmCommand(({ model, status }) =>
      this.planZones(armedZones(status), target, what, { model }),
    );
  }

  setZone(zone, armed) {
    const what = `zone ${zone} ${armed ? 'on' : 'off'}`;
    const plan = (current) => {
      if (armed) return current.includes(zone) ? current : [...current, zone];
      // The panel only disarms the three zones together ("Arrêt A B C").
      return current.includes(zone) ? [] : current;
    };
    if (this.status) {
      const current = armedZones(this.status);
      this.planZones(current, plan(current), what, { dryRun: true });
    }
    return this.alarmCommand(({ model, status }) => {
      const current = armedZones(status);
      return this.planZones(current, plan(current), what, { model });
    });
  }

  /**
   * The forms that take the zones from `current` to `target`: arm the missing
   * zones one by one (all three at once when all are missing), or disarm
   * everything first when a zone must go off (the panel has no per-zone
   * disarm), then arm the target zones. Throws Refused when the
   * configuration forbids it.
   */
  planZones(current, target, what, { model, dryRun = false } = {}) {
    const sorted = ZONES.filter((zone) => target.includes(zone));
    const disarm = current.some((zone) => !sorted.includes(zone));
    const toArm = disarm ? sorted : sorted.filter((zone) => !current.includes(zone));
    if (disarm && !this.config.allowDisarm) {
      this.logger.warn(
        `Disarm REFUSED (${what}): disarming from Gladys is disabled in the configuration`,
      );
      throw new Refused(word(T.disarmRefused, this.language));
    }
    if (toArm.length > 0 && !this.config.allowArm) {
      this.logger.warn(
        `Arm REFUSED (${what}): arming from Gladys is disabled in the configuration`,
      );
      throw new Refused(word(T.armRefused, this.language));
    }
    if (dryRun) {
      return [];
    }
    const forms = [];
    if (disarm) {
      this.logger.info(`DISARMING zones A B C from Gladys (${what})`);
      forms.push(model.forms.disarm);
    }
    if (toArm.length === ZONES.length) {
      this.logger.info(`ARMING zones A B C from Gladys (${what})`);
      forms.push(model.forms.arm(ZONES));
    } else {
      for (const zone of toArm) {
        this.logger.info(`ARMING zone ${zone} from Gladys (${what})`);
        forms.push(model.forms.arm([zone]));
      }
    }
    const until = this.now() + TIMINGS.commandMemory;
    for (const zone of ZONES) {
      if (current.includes(zone) !== sorted.includes(zone)) {
        this.commanded.set(zone, { armed: sorted.includes(zone), until });
      }
    }
    if (forms.length === 0) {
      this.logger.info(`Alarm already as asked (${what}): nothing sent`);
    }
    return forms;
  }

  alarmCommand(plan) {
    return this.command(plan, { readFirst: true });
  }

  /** One command session; its final status is applied like a poll. */
  async command(plan, options = {}) {
    let result;
    try {
      result = await this.exclusive(() => this.panel.control(plan, options));
    } catch (err) {
      if (!(err instanceof PanelError)) {
        throw err;
      }
      await this.failed(err);
      throw new Error(this.describe(err), { cause: err });
    }
    await this.apply(result.after);
    if (result.forms.length > 0 && result.before) {
      this.logger.info(
        `Alarm command done: ${armedZones(result.before).join(' ') || 'none'} -> ${armedZones(result.after).join(' ') || 'none'}`,
      );
    }
    return undefined;
  }

  /** A panel error in the user's language when we have a message for it. */
  describe(err) {
    const messages = {
      wrong_code: () => T.wrongCode([err.cell]),
      card_missing: () => T.cardMissing(err.cell),
      busy: () => T.busy,
      not_detected: () => T.notDetected,
      wrong_credentials: () => T.stoppedUserCode,
      max_attempts: () => T.stoppedLocked,
    };
    return messages[err.kind] ? word(messages[err.kind](), this.language) : err.message;
  }

  // --- Configuration buttons and scene actions --------------------------------

  /** "Test the connection": finds the panel again and reads it; also lifts a stop. */
  async testConnection() {
    if (!this.config.url) throw this.error(T.noUrl);
    this.stopped = undefined;
    this.refusedCells = [];
    this.pendingImport = undefined;
    this.panel.configure(this.config);
    let detected;
    try {
      detected = await this.exclusive(() => this.panel.detect({ force: true }));
    } catch (err) {
      await this.failed(err);
      throw new Error(this.describe(err), { cause: err });
    }
    if (!this.config.userCode) {
      throw this.error(T.noCode);
    }
    if (this.config.card.problem) {
      return T.testDetected(detected);
    }
    try {
      const status = await this.exclusive(() => this.panel.readStatus({ takeOver: true }));
      await this.apply(status);
      if (!this.timer && !this.running) this.schedule();
      return T.testOk(detected, armedZones(status), this.config.card);
    } catch (err) {
      await this.failed(err);
      throw new Error(this.describe(err), { cause: err });
    }
  }

  /**
   * "Import the card", in two clicks: the first reads the cell the panel asks
   * (and pauses the reads, so the panel keeps asking it); the second logs in
   * with the code of that cell typed by the user, reads the card print page
   * and saves its 30 codes in the configuration.
   */
  async importCard(fields = {}) {
    if (!this.config.url) throw this.error(T.noUrl);
    if (!this.config.userCode) throw this.error(T.noCode);
    const key = String(fields.cell_code ?? '').trim();
    const pending =
      this.pendingImport && this.now() < this.pendingImport.until ? this.pendingImport : undefined;
    if (!pending || key === '') {
      const step = await this.exclusive(() => this.panel.beginImport()).catch(async (err) => {
        await this.failed(err);
        throw new Error(this.describe(err), { cause: err });
      });
      this.pendingImport = { ...step, until: this.now() + TIMINGS.importWindow };
      this.logger.info(`Card import: the panel asks for cell ${step.cell}`);
      await this.setStatus(false, T.importing);
      const ask = T.importAsk(step.cell);
      return step.model.cardAccount === 'a'
        ? { en: `${ask.en} ${T.importAdmin.en}`, fr: `${ask.fr} ${T.importAdmin.fr}` }
        : ask;
    }
    this.pendingImport = undefined;
    let codes;
    try {
      codes = await this.exclusive(() =>
        this.panel.finishImport(pending, {
          key,
          adminCode: String(fields.admin_code ?? '').trim(),
        }),
      );
    } catch (err) {
      this.logger.warn(`Card import failed: ${err.message}`);
      if (err.kind === 'admin_code') throw this.error(T.importAdmin, err);
      throw new Error(this.describe(err), { cause: err });
    }
    const text = formatCard(codes);
    await this.gladys.setConfig({ auth_card: text });
    this.logger.info('Card import: 30 codes saved in the configuration');
    // Applied at once (the config-updated event may follow, it is then a no-op).
    const raw = await this.gladys.getConfig().catch(() => ({ ...(this.gladys.config ?? {}) }));
    await this.start({ ...raw, auth_card: text });
    return T.importDone(parseCard(text).count);
  }

  /** "Read the panel now". */
  async refresh() {
    this.ensureReady();
    const before = this.reads;
    await this.tick();
    if (!this.status || this.reads === before) {
      // The read failed or was skipped: the status message says why.
      const [, message] = this.lastStatus ? JSON.parse(this.lastStatus) : [];
      throw this.error(message ?? T.notReady);
    }
    return T.connected(this.panel.detected, armedZones(this.status));
  }

  /** Clears the fault memories of the panel (alarm, battery, link, or all). */
  async resetFaults(fields = {}) {
    this.ensureReady();
    const fault = String(fields.fault ?? 'all');
    const faults = FAULTS.includes(fault) ? [fault] : FAULTS;
    let status;
    try {
      status = await this.exclusive(() => this.panel.resetFaults(faults));
    } catch (err) {
      await this.failed(err);
      throw new Error(this.describe(err), { cause: err });
    }
    this.logger.info(`Fault memory cleared: ${faults.join(', ')}`);
    await this.apply(status);
    return T.faultsCleared;
  }
}

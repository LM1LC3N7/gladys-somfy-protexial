// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULTS, LANGUAGES } from '../src/config.js';
import {
  ACTIONS,
  FAULTS,
  POLL_ARMED,
  POLL_DISARMED,
  SCENE_ACTIONS,
  SCENE_TRIGGERS,
  ZONES,
} from '../src/constants.js';
import { MODEL_KEYS } from '../src/models.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const handlers = read('src/handlers.js');
const events = read('src/events.js');

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, entry] of node.entries()) {
      yield* texts(entry, `${path}[${i}]`);
    }
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      yield* texts(value, `${path}.${key}`);
    }
  }
}

const allFields = [
  ...manifest.config_schema,
  ...[...manifest.actions, ...manifest.scene_triggers, ...manifest.scene_actions].flatMap(
    (item) => item.fields ?? [],
  ),
];

test('the store basics', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'device');
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
  assert.match(
    manifest.gladys_version,
    /^>=5\.1\.0$/,
    'scene triggers and actions need Gladys 5.1',
  );
  assert.equal(
    manifest.docker_image,
    `ghcr.io/lm1lc3n7/gladys-somfy-protexial:${manifest.version}`,
  );
  assert.equal(manifest.version, JSON.parse(read('package.json')).version);
  assert.deepEqual(manifest.transports, ['local']);
  assert.deepEqual(manifest.categories, ['security']);
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    const docs = read(`docs/${lang}.md`);
    assert.ok(docs.length >= 300, `docs/${lang}.md is too short for the store`);
    assert.match(docs, /not\s+affiliated\s+with\s+Somfy|sans\s+lien\s+avec\s+Somfy/i);
  }
});

test('every text is in English and French', () => {
  for (const [path, text] of texts(manifest)) {
    for (const lang of ['en', 'fr']) {
      assert.ok(text[lang]?.trim(), `${path} needs ${lang}`);
    }
  }
});

test('the configuration matches the code', () => {
  const fields = Object.fromEntries(manifest.config_schema.map((f) => [f.key, f]));
  for (const [key, value] of Object.entries(DEFAULTS)) {
    assert.ok(fields[key], `${key} is not in the config_schema`);
    assert.deepEqual(fields[key].default, value, key);
  }
  assert.equal(fields.allow_disarm.default, false, 'disarming from Gladys is opt-in');
  assert.deepEqual(
    fields.language.options.map((o) => o.value),
    LANGUAGES,
  );
  assert.deepEqual(
    fields.model.options.map((o) => o.value),
    ['auto', ...MODEL_KEYS],
  );
  assert.equal(fields.url.type, 'string');
  assert.equal(fields.user_code.type, 'secret', 'the user code is never sent back to the browser');
  assert.equal(fields.auth_card.type, 'secret', 'nor the card');
  assert.equal(fields.url.required && fields.user_code.required, true);
  assert.equal(fields.auth_card.required, false, 'the import fills it');
  assert.deepEqual(
    [fields.poll_interval.min, fields.poll_interval.max],
    [POLL_ARMED.min, POLL_ARMED.max],
  );
  assert.deepEqual(
    [fields.poll_interval_disarmed.min, fields.poll_interval_disarmed.max],
    [POLL_DISARMED.min, POLL_DISARMED.max],
  );
  for (const section of manifest.config_schema.filter((f) => f.type === 'section')) {
    assert.equal(
      section.required ?? section.default ?? section.placeholder,
      undefined,
      section.key,
    );
    assert.ok(!(section.key in DEFAULTS));
    for (const lang of ['en', 'fr']) {
      assert.ok(
        section.description[lang].length <= 1000,
        `${section.key}.${lang} over 1000 characters`,
      );
    }
    assert.ok((section.links ?? []).every((l) => l.url.startsWith('https://')));
  }
  for (const field of allFields.filter((f) => f.placeholder !== undefined)) {
    assert.equal(typeof field.placeholder, 'object', field.key);
  }
});

test('the keys of the manifest are the keys of the code', () => {
  assert.deepEqual(manifest.actions.map((a) => a.key).sort(), Object.values(ACTIONS).sort());
  for (const name of Object.keys(ACTIONS)) {
    assert.ok(handlers.includes(`onAction(ACTIONS.${name}`), `ACTIONS.${name} has no handler`);
  }
  assert.deepEqual(
    manifest.scene_actions.map((a) => a.key).sort(),
    Object.values(SCENE_ACTIONS).sort(),
  );
  for (const name of Object.keys(SCENE_ACTIONS)) {
    assert.ok(handlers.includes(`onSceneAction(SCENE_ACTIONS.${name}`), name);
  }
  assert.deepEqual(
    manifest.scene_triggers.map((t) => t.key).sort(),
    Object.values(SCENE_TRIGGERS).sort(),
  );
  const faultOptions = (item) =>
    item.fields.find((f) => f.key === 'fault').options.map((o) => o.value);
  for (const item of [
    manifest.actions.find((a) => a.key === ACTIONS.RESET_FAULTS),
    manifest.scene_actions.find((a) => a.key === SCENE_ACTIONS.RESET_FAULTS),
  ]) {
    assert.deepEqual(faultOptions(item), ['all', ...FAULTS]);
  }
});

test('the trigger fields and variables are what the events carry', () => {
  const expected = {
    alarm_triggered: ['zones'],
    alarm_armed: ['zone', 'zone', 'zones', 'by_gladys'],
    alarm_disarmed: ['zone', 'zone', 'zones', 'by_gladys'],
    intrusion_or_tamper: ['kind', 'kind', 'armed'],
    battery_low: [],
  };
  for (const trigger of manifest.scene_triggers) {
    const declared = [...(trigger.fields ?? []), ...(trigger.variables ?? [])].map((f) => f.key);
    assert.deepEqual(declared, expected[trigger.key], trigger.key);
    for (const key of new Set(declared)) {
      assert.match(events, new RegExp(`\\b${key}[:,]`), `${trigger.key}: ${key} is never sent`);
    }
  }
  const zoneField = manifest.scene_triggers.find((t) => t.key === 'alarm_armed').fields[0];
  assert.deepEqual(
    zoneField.options.map((o) => o.value),
    ZONES,
    'the zone filter compares the zone letters the events send',
  );
});

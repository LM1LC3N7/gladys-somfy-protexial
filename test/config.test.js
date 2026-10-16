import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, normalizeConfig, normalizeUrl, sessionKey } from '../src/config.js';
import { CARD_TYPED } from './fixtures/pages.js';

test('the panel address: scheme, host and port only', () => {
  assert.equal(normalizeUrl('192.168.1.30'), 'http://192.168.1.30');
  assert.equal(normalizeUrl(' http://192.168.1.30:9876/fr/login.htm '), 'http://192.168.1.30:9876');
  assert.equal(normalizeUrl('https://alarme.lan/'), 'https://alarme.lan');
  assert.equal(normalizeUrl('ftp://192.168.1.30'), '');
  assert.equal(normalizeUrl('http://'), '');
  assert.equal(normalizeUrl(''), '');
  assert.equal(normalizeUrl(undefined), '');
});

test('defaults: arming allowed, disarming not, 60 s armed and 5 min disarmed', () => {
  const config = normalizeConfig({});
  assert.deepEqual(
    {
      model: config.model,
      allowArm: config.allowArm,
      allowDisarm: config.allowDisarm,
      pollArmed: config.pollArmed,
      pollDisarmed: config.pollDisarmed,
      language: config.language,
    },
    {
      model: DEFAULTS.model,
      allowArm: true,
      allowDisarm: false,
      pollArmed: 60,
      pollDisarmed: 300,
      language: 'fr',
    },
  );
  assert.equal(config.card.problem, 'empty');
});

test('values are bounded and checked', () => {
  const config = normalizeConfig({
    url: '10.0.0.2',
    user_code: ' 1234 ',
    auth_card: CARD_TYPED,
    model: 'PROTEXIOM',
    allow_arm: false,
    allow_disarm: true,
    poll_interval: 5,
    poll_interval_disarmed: 999999,
    language: 'EN',
  });
  assert.equal(config.userCode, '1234');
  assert.equal(config.card.count, 30);
  assert.equal(config.model, 'protexiom');
  assert.equal(config.allowArm, false);
  assert.equal(config.allowDisarm, true);
  assert.equal(config.pollArmed, 30);
  assert.equal(config.pollDisarmed, 86400);
  assert.equal(config.language, 'en');
  const odd = normalizeConfig({
    model: 'nope',
    allow_disarm: 'yes',
    poll_interval: 'x',
    language: 'de',
  });
  assert.equal(odd.model, 'auto');
  assert.equal(odd.allowDisarm, false, 'only a real true allows disarming');
  assert.equal(odd.pollArmed, 60);
  assert.equal(odd.language, 'fr');
});

test('the session key changes with the address, code, card or model only', () => {
  const base = { url: '10.0.0.2', user_code: '1', auth_card: CARD_TYPED };
  const key = sessionKey(normalizeConfig(base));
  assert.equal(sessionKey(normalizeConfig({ ...base, language: 'en', poll_interval: 90 })), key);
  assert.notEqual(sessionKey(normalizeConfig({ ...base, user_code: '2' })), key);
  assert.notEqual(sessionKey(normalizeConfig({ ...base, model: 'protexiom' })), key);
});

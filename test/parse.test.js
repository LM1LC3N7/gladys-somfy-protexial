// -----------------------------------------------------------------------------
// The pages of each web interface (test/fixtures/pages.js) read with the
// selectors of its model, and status.xml in its variants.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODELS, MODEL_KEYS } from '../src/models.js';
import {
  armedZones,
  asciiLower,
  errorKind,
  parseCardPage,
  parseChallenge,
  parseErrorCode,
  parseFooterYear,
  parseStatus,
} from '../src/parse.js';
import { CARD, cardPage, errorPage, loginPage, statusXml } from './fixtures/pages.js';

const STATE = {
  zones: { A: false, B: false, C: false },
  faults: { battery: false, radio: false, door: false, alarm: false, box: false },
  gsm: true,
  signal: 4,
  operator: 'Orange F',
  camera: true,
};

test('each model reads the cell asked on its own login page', () => {
  for (const key of MODEL_KEYS) {
    assert.equal(parseChallenge(loginPage(key, { cell: 'D2' }), MODELS[key]), 'D2', key);
  }
});

test('the login pages are told apart by their selectors', () => {
  // Protexial and Protexial IO share their paths: the IO selector is tried first.
  assert.equal(parseChallenge(loginPage('protexial'), MODELS.protexial_io), undefined);
  assert.equal(parseChallenge(loginPage('protexial_io'), MODELS.protexial), undefined);
  // A classic Protexiom page also matches the ALT selector (the reason ALT comes last).
  assert.equal(parseChallenge(loginPage('protexiom', { cell: 'C3' }), MODELS.protexiom_alt), 'C3');
  assert.equal(parseChallenge(loginPage('protexiom_alt'), MODELS.protexiom), undefined);
  assert.equal(parseChallenge('<html><body>404</body></html>', MODELS.protexial), undefined);
});

test('the year of the interface, from the footer or the copyright line', () => {
  assert.equal(parseFooterYear(loginPage('protexial', { year: '2010' }), MODELS.protexial), '2010');
  assert.equal(
    parseFooterYear(loginPage('protexial_io', { year: '2014' }), MODELS.protexial_io),
    '2014',
  );
  assert.equal(parseFooterYear(loginPage('protexiom', { year: '2008' }), MODELS.protexiom), '2008');
  assert.equal(parseFooterYear('<p>nothing</p>', MODELS.protexiom), undefined);
});

test('the error codes of the error page', () => {
  assert.equal(parseErrorCode(errorPage('protexial', '(0x0B00)'), MODELS.protexial), '(0x0B00)');
  assert.equal(parseErrorCode(errorPage('protexiom', '(0x0b00)'), MODELS.protexiom), '(0x0B00)');
  assert.equal(parseErrorCode('<p>Erreur (0x0902) session</p>', MODELS.protexial), '(0x0902)');
  assert.equal(parseErrorCode('<p>Erreur</p>', MODELS.protexial), undefined);
  assert.equal(errorKind('(0x0B00)'), 'wrong_code');
  assert.equal(errorKind('(0x1101)'), 'wrong_code');
  assert.equal(errorKind('(0x0812)'), 'wrong_credentials');
  assert.equal(errorKind('(0x0904)'), 'max_attempts');
  assert.equal(errorKind('(0x0902)'), 'busy');
  assert.equal(errorKind('(0x0811)'), 'access_rights');
  assert.equal(errorKind('(0x0A03)'), 'unknown_parameter');
  assert.equal(errorKind('(0x9999)'), 'unexpected');
  assert.equal(errorKind(undefined), 'unexpected');
});

test('status.xml: all fine, disarmed', () => {
  const status = parseStatus(statusXml(STATE));
  assert.deepEqual(status.zones, { A: false, B: false, C: false });
  assert.deepEqual(
    [status.battery, status.radio, status.door, status.alarm, status.box],
    [false, false, false, false, false],
  );
  assert.deepEqual(status.gsm, { text: 'GSM connecté au réseau', connected: true });
  assert.equal(status.signal, 4);
  assert.equal(status.operator, 'Orange F');
  assert.equal(status.camera, true);
  assert.equal(status.empty, false);
  assert.deepEqual(armedZones(status), []);
});

test('status.xml: zones armed, faults, GSM lost', () => {
  const status = parseStatus(
    statusXml({
      ...STATE,
      zones: { A: true, B: false, C: true },
      faults: { battery: true, radio: true, door: true, alarm: true, box: true },
      gsm: false,
      camera: false,
    }),
  );
  assert.deepEqual(armedZones(status), ['A', 'C']);
  assert.deepEqual(
    [status.battery, status.radio, status.door, status.alarm, status.box],
    [true, true, true, true, true],
  );
  assert.equal(status.gsm.connected, false);
  assert.equal(status.camera, false);
});

test('status.xml: a panel without GSM nor camera, odd values', () => {
  const status = parseStatus(statusXml({ ...STATE, gsm: null, camera: null }));
  assert.equal(status.gsm, undefined);
  assert.equal(status.signal, undefined);
  assert.equal(status.operator, undefined);
  assert.equal(status.camera, undefined);
  const odd = parseStatus(
    '<response><zone0> ON </zone0><zone1>off</zone1><zone2/><defaut0>OK</defaut0>' +
      '<defaut3>ok</defaut3><recgsm>9</recgsm><opegsm>""</opegsm></response>',
  );
  assert.deepEqual(odd.zones, { A: true, B: false, C: false });
  assert.equal(odd.battery, false);
  assert.equal(odd.radio, undefined, 'a missing flag is unknown, not ok');
  assert.equal(odd.signal, 5, 'clamped to 0-5');
  assert.equal(odd.operator, undefined);
});

test('status.xml: the GSM text read as the reference does (ASCII filter) or without accents', () => {
  // A UTF-8 panel decoded as ISO-8859-15, or the other way round: the accents break.
  for (const text of [
    'GSM connecté au réseau',
    'GSM connectÃ© au rÃ©seau',
    'GSM connect� au r�seau',
  ]) {
    const status = parseStatus(
      `<response><zone0>off</zone0><zone1>off</zone1><zone2>off</zone2><defaut3>ok</defaut3><gsm>${text}</gsm></response>`,
    );
    assert.equal(status.gsm.connected, true, text);
  }
  assert.equal(asciiLower('GSM connecté\tau réseau'), 'gsm connect\tau rseau');
});

test('status.xml: the empty answer of the firmware bug, and garbage', () => {
  assert.equal(parseStatus(statusXml(STATE, { empty: true })).empty, true);
  assert.throws(() => parseStatus('<html>login</html>'), { kind: 'bad_status' });
});

test('the card print page: 30 codes, row by row', () => {
  for (const key of MODEL_KEYS) {
    assert.deepEqual(parseCardPage(cardPage(key), MODELS[key]), CARD, key);
  }
  const partial = cardPage('protexial').replace(`<td>${CARD.F5}</td>`, '');
  assert.equal(parseCardPage(partial, MODELS.protexial), undefined);
});

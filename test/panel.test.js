// -----------------------------------------------------------------------------
// The panel client against the fake panel of each model: detection, one
// login / work / logout session per operation, the forms each model expects,
// the error pages, the card import.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCard } from '../src/card.js';
import { PanelClient } from '../src/panel.js';
import { MODELS, MODEL_KEYS } from '../src/models.js';
import { FakePanel, startServer } from './helpers/fakePanel.js';
import { CARD_TYPED } from './fixtures/pages.js';
import { nodeTransport } from '../src/http.js';

const URL = 'http://panel.local';

function client(panel, { model = 'auto', card = CARD_TYPED, userCode = '1234', url = URL } = {}) {
  const sleeps = [];
  const panelClient = new PanelClient({
    transport: panel.transport,
    sleep: async (ms) => sleeps.push(ms),
  });
  panelClient.configure({ url, userCode, card: parseCard(card), model });
  return { panelClient, sleeps };
}

const paths = (panel) => panel.requests.map(({ method, path }) => `${method} ${path}`);

test('detects each model, its year and version', async () => {
  const expected = {
    protexial: { year: '2010', version: 'v8_1', prefix: 'fr' },
    protexial_io: { year: '2014', version: 'v10_13', prefix: 'fr' },
    protexiom: { year: '2008', version: undefined, prefix: 'fr' },
    protexiom_alt: { year: '2009', version: undefined, prefix: 'fr' },
  };
  for (const key of MODEL_KEYS) {
    const { year, version } = expected[key];
    const panel = new FakePanel({ model: key, year, version: version ?? 'none' });
    const { panelClient } = client(panel);
    const detected = await panelClient.detect();
    assert.equal(detected.model.key, key);
    assert.equal(detected.year, year, key);
    assert.equal(detected.version, version, key);
    assert.equal(detected.prefix, 'fr');
    // Only GETs: detection never posts anything.
    assert.ok(
      panel.requests.every((r) => r.method === 'GET'),
      key,
    );
  }
});

test('a German Protexial: /de/ pages from the root redirection', async () => {
  const panel = new FakePanel({ model: 'protexial', prefix: 'de' });
  const { panelClient } = client(panel);
  const detected = await panelClient.detect();
  assert.equal(detected.prefix, 'de');
  assert.equal(detected.pages.login, '/de/login.htm');
  assert.equal(detected.pages.status, '/status.xml');
  await panelClient.readStatus();
  assert.ok(paths(panel).includes('POST /de/login.htm'));
});

test('a model chosen by hand skips the detection of the others', async () => {
  const panel = new FakePanel({ model: 'protexiom' });
  const { panelClient } = client(panel, { model: 'protexiom' });
  assert.equal((await panelClient.detect()).model.key, 'protexiom');
  assert.ok(!paths(panel).some((p) => p.includes('/cfg/vers')));
});

test('nothing Somfy at that address', async () => {
  const panel = new FakePanel({ model: 'protexial' });
  panel.handle = () => ({ status: 404, headers: {}, body: Buffer.from('no') });
  const { panelClient } = client(panel);
  await assert.rejects(panelClient.detect(), { kind: 'not_detected' });
});

test('one read = login page, login, status.xml, logout, for every model', async () => {
  for (const key of MODEL_KEYS) {
    const panel = new FakePanel({ model: key });
    panel.state.zones.B = true;
    const { panelClient } = client(panel);
    await panelClient.detect();
    panel.requests = [];
    const status = await panelClient.readStatus();
    assert.deepEqual(status.zones, { A: false, B: true, C: false }, key);
    const pages = MODELS[key].pages;
    assert.deepEqual(
      paths(panel),
      [
        `GET ${pages.login}`,
        `POST ${pages.login}`,
        `GET ${pages.pilotage}`, // the redirection after the login
        `GET /status.xml`,
        `GET /logout.htm`,
        `GET ${pages.login}`,
      ],
      key,
    );
    assert.equal(panel.session, undefined, `${key}: logged out`);
    // The card code of the cell asked was sent.
    const login = panel.requests.find((r) => r.method === 'POST');
    assert.equal(login.form.key, panel.card.B1);
    assert.equal(login.form.login, 'u');
    assert.equal(login.form.password, '1234');
  }
});

test('the cell asked changes at each login: each one uses its own code', async () => {
  const panel = new FakePanel({ model: 'protexial_io' });
  const { panelClient } = client(panel);
  for (let i = 0; i < 4; i += 1) {
    await panelClient.readStatus();
  }
  const keys = panel.requests.filter((r) => r.method === 'POST').map((r) => r.form.key);
  assert.deepEqual(
    keys,
    ['B1', 'D3', 'F5', 'A2'].map((cell) => panel.card[cell]),
  );
});

test('login refusals carry their kind and the cell', async () => {
  const panel = new FakePanel({ model: 'protexial' });
  const wrongCard = parseCard(CARD_TYPED).text.replace(/B1=\d+/, 'B1=0000');
  const { panelClient } = client(panel, { card: wrongCard });
  await assert.rejects(panelClient.readStatus(), {
    kind: 'wrong_code',
    cell: 'B1',
    code: '(0x0B00)',
  });
  const other = client(new FakePanel({ model: 'protexial' }), { userCode: '9999' }).panelClient;
  await assert.rejects(other.readStatus(), { kind: 'wrong_credentials' });
  const missing = client(new FakePanel({ model: 'protexial' }), {
    card: parseCard(CARD_TYPED).text.replace(/B1=\d+ /, ''),
  }).panelClient;
  await assert.rejects(missing.readStatus(), { kind: 'card_missing', cell: 'B1' });
  const noCode = client(new FakePanel(), { userCode: '' }).panelClient;
  await assert.rejects(noCode.readStatus(), { kind: 'no_code' });
});

test('the panel locks after repeated wrong codes (0x0904)', async () => {
  const panel = new FakePanel({ model: 'protexiom', lockAfter: 2 });
  const { panelClient } = client(panel, { userCode: '0000' });
  await assert.rejects(panelClient.readStatus(), { kind: 'wrong_credentials' });
  await assert.rejects(panelClient.readStatus(), { kind: 'max_attempts' });
  assert.equal(panel.locked, true);
});

test('0x0811 is retried once, after acknowledging the error page and a pause', async () => {
  const panel = new FakePanel({ model: 'protexial' });
  panel.nextLoginErrors = ['(0x0811)'];
  const { panelClient, sleeps } = client(panel);
  const status = await panelClient.readStatus();
  assert.equal(status.zones.A, false);
  assert.deepEqual(sleeps, [5000]);
  assert.ok(
    panel.requests.some(
      (r) => r.method === 'POST' && r.path === '/fr/error.htm' && r.form.btn_ok === 'OK',
    ),
  );
  panel.nextLoginErrors = ['(0x0811)', '(0x0811)'];
  await assert.rejects(panelClient.readStatus(), { kind: 'access_rights' });
});

test('another session open (0x0902): refused, or taken over when asked', async () => {
  const panel = new FakePanel({ model: 'protexiom' });
  panel.otherSession = true;
  const { panelClient } = client(panel);
  await assert.rejects(panelClient.readStatus(), { kind: 'busy' });
  assert.equal(panel.otherSession, true, 'not taken over by default');
  const status = await panelClient.readStatus({ takeOver: true });
  assert.ok(status);
  assert.ok(panel.requests.some((r) => r.path === '/error.htm' && r.form?.action === 'OK'));
});

test('the logout happens even when the work fails', async () => {
  const panel = new FakePanel({ model: 'protexial' });
  const { panelClient } = client(panel);
  await assert.rejects(
    panelClient.session(async () => {
      throw new Error('boom');
    }),
    /boom/,
  );
  assert.equal(panel.session, undefined);
  assert.equal(paths(panel).filter((p) => p === 'GET /logout.htm').length, 1);
});

test('control: the forms of each model, then the status in the same session', async () => {
  for (const key of MODEL_KEYS) {
    const panel = new FakePanel({ model: key });
    const { panelClient, sleeps } = client(panel);
    const { model } = await panelClient.detect();
    const result = await panelClient.control(
      ({ status }) => {
        assert.deepEqual(status.zones, { A: false, B: false, C: false });
        return [model.forms.arm(['A']), model.forms.arm(['C'])];
      },
      { readFirst: true },
    );
    assert.deepEqual(result.after.zones, { A: true, B: false, C: true }, key);
    assert.deepEqual(sleeps, [1000], 'a pause between two forms');
    await panelClient.control(() => [model.forms.disarm]);
    assert.deepEqual(panel.state.zones, { A: false, B: false, C: false }, `${key}: disarmed`);
    await panelClient.control(() => [model.forms.arm(['A', 'B', 'C'])]);
    assert.deepEqual(panel.state.zones, { A: true, B: true, C: true }, `${key}: total`);
    await panelClient.control(() => [model.forms.lightOn]);
    assert.equal(panel.lights, 'ON');
    await panelClient.control(() => [model.forms.shutterClose, model.forms.shutterStop]);
    assert.equal(panel.shutter.length, 2);
    assert.equal(panel.session, undefined);
  }
});

test('the disarm form is encoded in the page encoding ("Arrêt")', async () => {
  for (const [key, encoded] of [
    ['protexial', 'Arr%EAt'],
    ['protexial_io', 'Arr%C3%AAt'],
  ]) {
    const seen = [];
    const panel = new FakePanel({ model: key });
    const transport = panel.transport;
    panel.transport = async (request) => {
      if (request.body) seen.push(request.body);
      return transport(request);
    };
    const { panelClient } = client(panel);
    panel.state.zones.A = true;
    const { model } = await panelClient.detect();
    await panelClient.control(() => [model.forms.disarm]);
    assert.ok(
      seen.some((body) => body.includes(`btn_zone_off_ABC=${encoded}+A+B+C`)),
      key,
    );
    assert.equal(panel.state.zones.A, false);
  }
});

test('a form the panel does not know is its error', async () => {
  const panel = new FakePanel({ model: 'protexial' });
  const { panelClient } = client(panel);
  await assert.rejects(
    panelClient.control(() => [{ hidden: 'hidden', nope: '1' }]),
    {
      kind: 'unknown_parameter',
    },
  );
  assert.equal(panel.session, undefined);
});

test('a plan that throws posts nothing', async () => {
  const panel = new FakePanel({ model: 'protexial' });
  const { panelClient } = client(panel);
  await assert.rejects(
    panelClient.control(
      () => {
        throw new Error('refused');
      },
      { readFirst: true },
    ),
    /refused/,
  );
  assert.equal(panel.posted.length, 0);
});

test('the empty status.xml of the firmware bug is reported, not guessed', async () => {
  const panel = new FakePanel({ model: 'protexial' });
  panel.emptyStatusOnce = true;
  const { panelClient } = client(panel);
  assert.equal((await panelClient.readStatus()).empty, true);
  assert.equal((await panelClient.readStatus()).empty, false);
});

test('reset faults: localized elements page, or the root one on a Protexiom', async () => {
  for (const [key, path] of [
    ['protexial', '/fr/u_listelmt.htm'],
    ['protexiom', '/u_listelmt.htm'],
  ]) {
    const panel = new FakePanel({ model: key });
    Object.assign(panel.state.faults, { alarm: true, battery: true, radio: true });
    const { panelClient } = client(panel);
    const status = await panelClient.resetFaults(['alarm', 'battery', 'link']);
    assert.deepEqual([status.alarm, status.battery, status.radio], [false, false, false], key);
    assert.ok(
      panel.requests.some((r) => r.method === 'POST' && r.path === path),
      key,
    );
  }
  // A German Protexial whose elements page is at the root: the localized one is a 404.
  const panel = new FakePanel({ model: 'protexial', prefix: 'de' });
  panel.pages.elements = '/u_listelmt.htm';
  panel.state.faults.battery = true;
  const { panelClient } = client(panel);
  const status = await panelClient.resetFaults(['battery']);
  assert.equal(status.battery, false);
  assert.deepEqual(
    panel.requests
      .filter((r) => r.method === 'POST' && r.path.includes('listelmt'))
      .map((r) => r.path),
    ['/de/u_listelmt.htm', '/u_listelmt.htm'],
  );
});

test('card import: the cell asked, then the code of that cell, the card page, logout', async () => {
  for (const key of ['protexial', 'protexial_io', 'protexiom']) {
    const panel = new FakePanel({ model: key });
    const { panelClient } = client(panel, { card: '' });
    const step = await panelClient.beginImport();
    assert.equal(step.cell, 'B1');
    const codes = await panelClient.finishImport(step, { key: panel.card.B1 });
    assert.deepEqual(codes, panel.card, key);
    assert.equal(panel.session, undefined);
    const login = panel.requests.find((r) => r.method === 'POST');
    assert.equal(login.form.key, panel.card.B1);
  }
});

test('card import of the ALT Protexiom: the administrator account', async () => {
  const panel = new FakePanel({ model: 'protexiom_alt' });
  const { panelClient } = client(panel, { card: '' });
  const step = await panelClient.beginImport();
  await assert.rejects(panelClient.finishImport(step, { key: panel.card.B1 }), {
    kind: 'admin_code',
  });
  const again = await panelClient.beginImport();
  const codes = await panelClient.finishImport(again, {
    key: panel.card[again.cell],
    adminCode: '9876',
  });
  assert.deepEqual(codes, panel.card);
  assert.equal(panel.requests.filter((r) => r.method === 'POST').at(-1).form.login, 'a');
});

test('card import with a wrong code: refused, nothing read', async () => {
  const panel = new FakePanel({ model: 'protexial' });
  const { panelClient } = client(panel, { card: '' });
  const step = await panelClient.beginImport();
  await assert.rejects(panelClient.finishImport(step, { key: '0000' }), {
    kind: 'wrong_code',
    cell: 'B1',
  });
  assert.ok(!panel.requests.some((r) => r.path === '/fr/u_print.htm'));
});

test('a whole read over real HTTP (loopback)', async (t) => {
  const panel = new FakePanel({ model: 'protexial_io', camera: true });
  const server = await startServer(panel);
  t.after(() => server.close());
  const panelClient = new PanelClient({ transport: nodeTransport(), sleep: async () => {} });
  panelClient.configure({
    url: server.url,
    userCode: '1234',
    card: parseCard(CARD_TYPED),
    model: 'auto',
  });
  assert.equal((await panelClient.detect()).model.key, 'protexial_io');
  panel.state.zones.C = true;
  const status = await panelClient.readStatus();
  assert.deepEqual(status.zones, { A: false, B: false, C: true });
  assert.equal(status.gsm.connected, true);
  assert.equal(status.camera, true);
  assert.equal(panel.session, undefined);
});

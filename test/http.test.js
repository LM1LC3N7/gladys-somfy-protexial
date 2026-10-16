// -----------------------------------------------------------------------------
// Encodings, the browser (cookies, redirections) and the real node:http
// transport against the fake panel on a loopback server.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Browser, decode, decodeForm, encode, encodeForm, nodeTransport } from '../src/http.js';
import { FakePanel, startServer } from './helpers/fakePanel.js';

test('ISO-8859-15 and UTF-8, both ways', () => {
  assert.deepEqual([...encode('Arrêt €', 'latin9')], [0x41, 0x72, 0x72, 0xea, 0x74, 0x20, 0xa4]);
  assert.equal(decode(Buffer.from([0xea, 0xa4, 0xbd, 0xe9]), 'latin9'), 'ê€œé');
  assert.equal(decode(Buffer.from('Arrêt', 'utf8'), 'utf8'), 'Arrêt');
  assert.deepEqual([...encode('¤ 中', 'latin9')], [0x3f, 0x20, 0x3f], 'not in ISO-8859-15: "?"');
});

test('forms are encoded like Python urlencode(encoding=…)', () => {
  const form = { hidden: 'hidden', btn_zone_off_ABC: 'Arrêt A B C', key: '0042' };
  assert.equal(encodeForm(form, 'latin9'), 'hidden=hidden&btn_zone_off_ABC=Arr%EAt+A+B+C&key=0042');
  assert.equal(
    encodeForm(form, 'utf8'),
    'hidden=hidden&btn_zone_off_ABC=Arr%C3%AAt+A+B+C&key=0042',
  );
  assert.equal(encodeForm({ a: "x&y=z/~'" }, 'utf8'), 'a=x%26y%3Dz%2F~%27');
  assert.deepEqual(decodeForm(encodeForm(form, 'latin9'), 'latin9'), form);
  assert.deepEqual(decodeForm(encodeForm(form, 'utf8'), 'utf8'), form);
});

test('the browser keeps cookies and follows redirections, POST becoming GET', async () => {
  const seen = [];
  const transport = async ({ method, url, headers, body }) => {
    seen.push({ method, path: new URL(url).pathname, cookie: headers.Cookie, body });
    if (url.endsWith('/login.htm') && method === 'POST') {
      return {
        status: 302,
        headers: {
          location: '/fr/u_pilotage.htm',
          'set-cookie': ['sessid=abc; path=/', 'lang=fr'],
        },
      };
    }
    return { status: 200, headers: {}, body: Buffer.from('ok') };
  };
  const browser = new Browser({ baseUrl: 'http://panel', transport, encoding: 'latin9' });
  const page = await browser.post('/login.htm', { a: '1' });
  assert.equal(page.path, '/fr/u_pilotage.htm');
  assert.equal(page.text, 'ok');
  assert.deepEqual(seen[1], {
    method: 'GET',
    path: '/fr/u_pilotage.htm',
    cookie: 'sessid=abc; lang=fr',
    body: undefined,
  });
  const raw = await browser.get('/x', { follow: false });
  assert.equal(raw.status, 200);
});

test('too many redirections', async () => {
  const transport = async () => ({
    status: 302,
    headers: { location: '/loop' },
    body: Buffer.alloc(0),
  });
  const browser = new Browser({ baseUrl: 'http://panel', transport });
  await assert.rejects(browser.get('/'), { kind: 'http' });
});

test('the node:http transport against the fake panel on a loopback server', async (t) => {
  const panel = new FakePanel({ model: 'protexial' });
  const server = await startServer(panel);
  t.after(() => server.close());
  const browser = new Browser({
    baseUrl: server.url,
    transport: nodeTransport(),
    encoding: 'latin9',
  });
  const login = await browser.get('/fr/login.htm');
  assert.equal(login.status, 200);
  assert.match(login.text, /Code d'acc&egrave;s/);
  const refused = await browser.post('/fr/login.htm', {
    login: 'u',
    password: 'bad',
    key: '0',
    btn_login: 'Connexion',
  });
  assert.equal(refused.path, '/fr/error.htm');
  assert.match(refused.text, /\(0x0812\)/);
});

test('the transport: size limit, timeout, refused connection', async (t) => {
  const server = http.createServer((req, res) => {
    if (req.url === '/big') {
      res.end(Buffer.alloc(2048, 0x41));
    }
    // /slow never answers
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const small = nodeTransport({ maxBytes: 1024, timeout: 200 });
  await assert.rejects(small({ method: 'GET', url: `${base}/big` }), { kind: 'size' });
  await assert.rejects(small({ method: 'GET', url: `${base}/slow` }), { kind: 'timeout' });
  await assert.rejects(small({ method: 'GET', url: 'http://127.0.0.1:1/' }), { kind: 'network' });
});

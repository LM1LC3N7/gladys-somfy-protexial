// -----------------------------------------------------------------------------
// A simulated panel behind the transport: the pages of test/fixtures/pages.js
// served the way the reference integration expects them (redirection to the
// error page with a code, session cookie, one session at a time, a new cell
// asked after each login, a lock after repeated wrong codes). Usable in memory
// (`panel.transport`) or as a real HTTP server (`startServer`), for the
// loopback tests and the Docker check.
// -----------------------------------------------------------------------------

import http from 'node:http';
import { CARD_CELLS } from '../../src/constants.js';
import { decodeForm, encode } from '../../src/http.js';
import { MODELS, localizedPages } from '../../src/models.js';
import {
  CARD,
  cardPage,
  errorPage,
  loginPage,
  pilotagePage,
  statusXml,
} from '../fixtures/pages.js';

const ERROR_TEXT = {
  '(0x0B00)': 'Code erroné',
  '(0x0812)': 'Identifiant ou mot de passe incorrect',
  '(0x0904)': "Nombre d'essais maximum atteint",
  '(0x0902)': 'Session déjà ouverte',
  '(0x0903)': "Droits d'accès insuffisants",
  '(0x0811)': "Connexion impossible, droit d'accès incorrect",
  '(0x1003)': 'Paramètre inconnu',
};

export class FakePanel {
  constructor({
    model = 'protexial',
    prefix = 'fr',
    year = '2010',
    version = 'v8_1',
    userCode = '1234',
    adminCode = '9876',
    card = CARD,
    lockAfter = 3,
    gsm = true,
    camera = false,
    cells = ['B1', 'D3', 'F5', 'A2', 'C4', 'E1'],
  } = {}) {
    this.model = model;
    this.definition = MODELS[model];
    this.prefix = prefix;
    this.pages = localizedPages(this.definition, prefix);
    this.year = year;
    this.version = version;
    this.userCode = userCode;
    this.adminCode = adminCode;
    this.card = card;
    this.lockAfter = lockAfter;
    this.cells = cells;
    this.cellIndex = 0;
    this.state = {
      zones: { A: false, B: false, C: false },
      faults: { battery: false, radio: false, door: false, alarm: false, box: false },
      gsm: gsm ? true : null,
      signal: 4,
      operator: 'Orange F',
      camera: camera ? true : null,
    };
    this.lights = undefined;
    this.shutter = [];
    this.session = undefined;
    /** Someone else (a browser) holds the session: logins answer 0x0902. */
    this.otherSession = false;
    this.attempts = 0;
    this.locked = false;
    this.lastError = undefined;
    /** Errors to answer to the next logins, e.g. ['(0x0811)']. */
    this.nextLoginErrors = [];
    this.emptyStatusOnce = false;
    this.requests = [];
    this.posted = [];
    this.logins = 0;
    this.transport = async (request) => this.handle(request);
  }

  get cell() {
    return this.cells[this.cellIndex % this.cells.length];
  }

  rotate() {
    this.cellIndex += 1;
  }

  page(text, status = 200, headers = {}) {
    return {
      status,
      headers: { 'content-type': 'text/html', ...headers },
      body: encode(text, this.definition.encoding),
    };
  }

  redirect(location, headers = {}) {
    return { status: 302, headers: { location, ...headers }, body: Buffer.alloc(0) };
  }

  error(code) {
    this.lastError = code;
    return this.redirect(this.pages.error);
  }

  authenticated(headers) {
    const cookie = String(headers?.Cookie ?? headers?.cookie ?? '');
    return this.session && cookie.includes(`sessid=${this.session.token}`);
  }

  handle({ method, url, headers = {}, body }) {
    const { pathname } = new URL(url);
    const form = body ? decodeForm(String(body), this.definition.encoding) : undefined;
    this.requests.push({ method, path: pathname, form });
    const { pages } = this;

    if (method === 'GET' && pathname === '/') {
      return this.redirect(pages.login);
    }
    if (method === 'GET' && pathname === pages.version && pages.version) {
      return {
        status: 200,
        headers: { 'content-type': 'text/plain' },
        body: Buffer.from(`${this.version}\n`),
      };
    }
    if (pathname === pages.login) {
      return method === 'GET'
        ? this.page(
            loginPage(this.model, { cell: this.cell, year: this.year, prefix: this.prefix }),
          )
        : this.login(form);
    }
    if (pathname === pages.error) {
      if (method === 'GET') {
        return this.page(
          errorPage(this.model, this.lastError ?? '(0x0000)', ERROR_TEXT[this.lastError]),
        );
      }
      const reset = this.definition.forms.resetSession;
      const [[key, value]] = Object.entries(reset);
      if (form?.[key] === value) {
        this.otherSession = false;
        this.session = undefined;
      }
      return this.redirect(pages.login);
    }
    if (pathname === pages.logout && method === 'GET') {
      this.session = undefined;
      return this.redirect(pages.login);
    }
    if (pathname === pages.status && method === 'GET') {
      if (!this.authenticated(headers)) return this.error('(0x0903)');
      const empty = this.emptyStatusOnce;
      this.emptyStatusOnce = false;
      return {
        status: 200,
        headers: { 'content-type': 'text/xml' },
        body: encode(statusXml(this.state, { empty }), this.definition.encoding),
      };
    }
    if (pathname === pages.pilotage && method === 'GET') {
      // Where a successful login lands.
      return this.authenticated(headers)
        ? this.page(pilotagePage(this.model))
        : this.error('(0x0903)');
    }
    if (pathname === pages.pilotage && method === 'POST') {
      if (!this.authenticated(headers)) return this.error('(0x0903)');
      this.posted.push(form);
      return this.control(form) ? this.page(pilotagePage(this.model)) : this.error('(0x1003)');
    }
    if (pathname === pages.elements && method === 'POST') {
      if (!this.authenticated(headers)) return this.error('(0x0903)');
      this.posted.push(form);
      return this.resetFault(form) ? this.page(pilotagePage(this.model)) : this.error('(0x1003)');
    }
    if (pathname === pages.card && method === 'GET') {
      if (!this.authenticated(headers)) return this.error('(0x0903)');
      if (this.definition.cardAccount === 'a' && this.session.account !== 'a')
        return this.error('(0x0903)');
      return this.page(cardPage(this.model, this.card));
    }
    return {
      status: 404,
      headers: { 'content-type': 'text/html' },
      body: Buffer.from('<h1>404</h1>'),
    };
  }

  login(form = {}) {
    this.logins += 1;
    const asked = this.cell;
    this.rotate();
    if (this.locked) return this.error('(0x0904)');
    if (this.otherSession || this.session) return this.error('(0x0902)');
    const forced = this.nextLoginErrors.shift();
    if (forced) return this.error(forced);
    const button = Object.entries(this.definition.forms.login('u', 'x', 'y')).at(-1);
    if (form[button[0]] !== button[1]) return this.error('(0x1003)');
    const password =
      form.login === 'a' ? this.adminCode : form.login === 'u' ? this.userCode : undefined;
    let code;
    if (password === undefined || form.password !== password) code = '(0x0812)';
    else if (form.key !== this.card[asked]) code = '(0x0B00)';
    if (code) {
      this.attempts += 1;
      if (this.attempts >= this.lockAfter) {
        this.locked = true;
        return this.error('(0x0904)');
      }
      return this.error(code);
    }
    this.attempts = 0;
    this.session = { token: `t${this.logins}`, account: form.login };
    return this.redirect(this.pages.pilotage, {
      'set-cookie': [`sessid=${this.session.token}; path=/`],
    });
  }

  /** Applies a control form the way the model writes it; false when it does not know it. */
  control(form) {
    const zones = this.state.zones;
    const armAll = () => Object.assign(zones, { A: true, B: true, C: true });
    if (this.model === 'protexiom' || this.model === 'protexiom_alt') {
      if (form.zone === 'Arrêt A B C')
        return Object.assign(zones, { A: false, B: false, C: false });
      if (form.zone === 'Marche A B C') return armAll();
      const single = /^Marche ([ABC])$/.exec(form.zone ?? '');
      if (single) return (zones[single[1]] = true);
      if (form.action_lum === 'ON' || form.action_lum === 'OFF')
        return (this.lights = form.action_lum);
      for (const key of ['action_vol_montee', 'action_vol_descente', 'action_vol_stop']) {
        if (key in form) return this.shutter.push(key);
      }
      return false;
    }
    const io = this.model === 'protexial_io';
    if (form.btn_zone_off_ABC === 'Arrêt A B C')
      return Object.assign(zones, { A: false, B: false, C: false });
    if (form.btn_zone_on_ABC === (io ? 'Marche A B C' : 'Marche')) return armAll();
    for (const zone of ['A', 'B', 'C']) {
      if (form[`btn_zone_on_${zone}`] === (io ? `Marche ${zone}` : 'Marche'))
        return (zones[zone] = true);
    }
    if (form.btn_lum_on === 'ON') return (this.lights = 'ON');
    if (form.btn_lum_off === 'OFF') return (this.lights = 'OFF');
    for (const key of ['btn_vol_up', 'btn_vol_down', 'btn_vol_stop']) {
      if (key in form) return this.shutter.push(key);
    }
    return false;
  }

  resetFault(form) {
    const value = form.efface ?? form.btn_del_pil ?? form.btn_del_alm ?? form.btn_del_lia;
    const faults = this.state.faults;
    if (value === 'Piles') faults.battery = false;
    else if (value === 'Alarmes') Object.assign(faults, { alarm: false, box: false, door: false });
    else if (value === 'Liaisons') faults.radio = false;
    else return false;
    return true;
  }
}

/** The fake panel on a real HTTP server: resolves `{ url, close }`. */
export function startServer(panel, { port = 0, host = '127.0.0.1' } = {}) {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = chunks.length ? Buffer.concat(chunks).toString('latin1') : undefined;
      const answer = panel.handle({
        method: req.method,
        url: `http://${req.headers.host}${req.url}`,
        headers: req.headers,
        body,
      });
      res.writeHead(answer.status, answer.headers);
      res.end(answer.body);
    });
  });
  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const { port: actual } = server.address();
      resolve({
        url: `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${actual}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

export { CARD, CARD_CELLS };

// -----------------------------------------------------------------------------
// The panel's web interface, the way the reference integration
// (AuroreVgn/somfy-protexial, MIT) drives it, but with one short session per
// operation: read the cell asked on the login page, post the user code and
// the card code of that cell, do the work (read status.xml, post a command),
// log out. The panel accepts one session at a time: keeping none open between
// two reads leaves room for the Somfy web page and app.
//
// Never repeats a command by itself, and never logs in twice in a row after
// a refusal (the app decides when to try again).
// -----------------------------------------------------------------------------

import { TIMINGS, LANGUAGE_PREFIXES } from './constants.js';
import { Browser, PanelError, nodeTransport } from './http.js';
import { DETECTION_ORDER, MODELS, elementsPages, localizedPages } from './models.js';
import {
  errorKind,
  parseCardPage,
  parseChallenge,
  parseErrorCode,
  parseFooterYear,
  parseStatus,
} from './parse.js';

const MESSAGES = {
  wrong_code: 'the panel refused the card code',
  wrong_credentials: 'the panel refused the user code',
  max_attempts: 'the panel blocks logins after too many attempts',
  busy: 'another session is open on the panel',
  not_authorized: 'not allowed (session expired?)',
  access_rights: 'the panel refused the access rights',
  unknown_parameter: 'the panel did not understand the command',
  bad_parameter: 'the panel refused the command',
  unexpected: 'the panel answered with an error',
};

export class PanelClient {
  constructor({ transport = nodeTransport(), sleep, logger } = {}) {
    this.transport = transport;
    this.sleep = sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.logger = logger;
    this.config = { url: '', userCode: '', card: { codes: {} }, model: 'auto' };
    /** { model, prefix, pages, year, version } once found. */
    this.detected = undefined;
  }

  configure({ url, userCode, card, model }) {
    this.config = { url, userCode, card, model };
    this.detected = undefined;
  }

  browserFor(model) {
    return new Browser({
      baseUrl: this.config.url,
      transport: this.transport,
      encoding: model.encoding,
    });
  }

  // --- Detection -------------------------------------------------------------

  /** GET without following: the page when 200, undefined when absent (another model). */
  async probe(browser, path) {
    const page = await browser.get(path, { follow: false });
    if (page.status === 200) {
      return page.text;
    }
    if ([301, 302, 303, 307].includes(page.status)) {
      throw new PanelError('unavailable', `The panel redirected ${path}: busy, retry later`);
    }
    return undefined;
  }

  /** The language of the web interface: `/` redirects to `/de/login.htm` on a German panel. */
  async detectPrefix(browser) {
    const root = await browser.get('/', { follow: false });
    if (root.location) {
      const path = new URL(root.location, this.config.url).pathname;
      const localized = path.match(/^\/([a-z]{2})\/login\.htm$/i);
      if (localized) {
        return localized[1].toLowerCase();
      }
      if (path === '/login.htm') {
        return 'fr'; // a Protexiom: pages at the root, no language prefix
      }
    }
    for (const prefix of LANGUAGE_PREFIXES) {
      const page = await browser.get(`/${prefix}/login.htm`, { follow: false });
      if (page.status === 200) {
        return prefix;
      }
    }
    return 'fr';
  }

  async detect({ force = false } = {}) {
    if (this.detected && !force) {
      return this.detected;
    }
    if (!this.config.url) {
      throw new PanelError('no_url', 'No panel address');
    }
    const prefix = await this.detectPrefix(this.browserFor(MODELS.protexial));
    const candidates = this.config.model === 'auto' ? DETECTION_ORDER : [this.config.model];
    for (const key of candidates) {
      const model = MODELS[key];
      const pages = localizedPages(model, prefix);
      const browser = this.browserFor(model);
      let version;
      if (pages.version) {
        version = await this.probe(browser, pages.version);
        if (version === undefined && this.config.model === 'auto') {
          continue;
        }
      }
      const login = await this.probe(browser, pages.login);
      if (login === undefined) {
        continue;
      }
      // The ALT selector also matches a classic Protexiom page: keep it a fallback.
      if (
        key === 'protexiom_alt' &&
        this.config.model === 'auto' &&
        parseChallenge(login, MODELS.protexiom)
      ) {
        continue;
      }
      if (!parseChallenge(login, model) && this.config.model === 'auto') {
        continue;
      }
      this.detected = {
        model,
        prefix,
        pages,
        year: parseFooterYear(login, model),
        version: version?.trim() || undefined,
      };
      this.logger?.info(
        `Panel found: ${model.name}${this.detected.year ? ` ${this.detected.year}` : ''}` +
          `${this.detected.version ? ` (${this.detected.version})` : ''}, pages /${prefix}/`,
      );
      return this.detected;
    }
    throw new PanelError('not_detected', 'No known Somfy login page at this address');
  }

  // --- Sessions --------------------------------------------------------------

  /** Throws the panel's error when an answer is its error page (or not a page). */
  check(page, pages, details = {}) {
    if (page.status !== 200) {
      throw new PanelError('http', `HTTP ${page.status} on ${page.path}`, {
        status: page.status,
        ...details,
      });
    }
    if (page.path === pages.error) {
      const code = parseErrorCode(page.text, this.detected.model);
      const kind = errorKind(code);
      throw new PanelError(kind, `${MESSAGES[kind]} ${code ?? ''}`.trim(), { code, ...details });
    }
    return page;
  }

  /** "OK" on the error page: the reference does it to clear 0x0902 and 0x0811. */
  async acknowledge(browser) {
    const { model, pages } = this.detected;
    await browser.post(pages.error, model.forms.resetSession).catch(() => undefined);
  }

  /** The cell asked by the login page. */
  async challenge(browser) {
    const { model, pages } = this.detected;
    const page = this.check(await browser.get(pages.login), pages);
    const cell = parseChallenge(page.text, model);
    if (!cell) {
      throw new PanelError('no_challenge', 'No card cell on the login page');
    }
    return cell;
  }

  /** Posts the login form; the card code is the one of the cell, or `key` when given. */
  async postLogin(browser, { cell, account, password, key }) {
    const { model, pages } = this.detected;
    const code = key ?? this.config.card.codes?.[cell];
    if (!code) {
      throw new PanelError('card_missing', `The card has no code for cell ${cell}`, { cell });
    }
    const page = await browser.post(pages.login, model.forms.login(account, password, code));
    return this.check(page, pages, { cell });
  }

  async login(browser, { account = 'u', password = this.config.userCode, takeOver = false } = {}) {
    if (!password) {
      throw new PanelError('no_code', 'No user code');
    }
    for (let attempt = 0; ; attempt += 1) {
      const cell = await this.challenge(browser);
      try {
        await this.postLogin(browser, { cell, account, password });
        return cell;
      } catch (err) {
        // 0x0811 is sometimes answered to a valid login: once, after a pause (reference).
        const retryRights = err.kind === 'access_rights' && attempt === 0;
        // 0x0902: a session is still open (ours, lost; or a browser). Taken over only when asked.
        const retryBusy = err.kind === 'busy' && takeOver && attempt === 0;
        if (!retryRights && !retryBusy) {
          throw err;
        }
        this.logger?.warn(`Panel: ${err.message}, retrying once`);
        await this.acknowledge(browser);
        if (retryRights) {
          await this.sleep(TIMINGS.accessRightsRetry);
        }
      }
    }
  }

  /** login, work({ browser, model, pages }), logout — whatever happens in work. */
  async session(work, options = {}) {
    const { model, pages } = await this.detect();
    const browser = this.browserFor(model);
    await this.login(browser, options);
    try {
      return await work({ browser, model, pages });
    } finally {
      await browser.get(pages.logout).catch(() => undefined);
    }
  }

  async getStatus(browser) {
    const { pages } = this.detected;
    const page = this.check(await browser.get(pages.status), pages);
    if (page.path === pages.default) {
      throw new PanelError('session_lost', 'Redirected to the default page: not logged in');
    }
    return parseStatus(page.text);
  }

  // --- Operations ------------------------------------------------------------

  /** One read: login, status.xml, logout. */
  readStatus(options) {
    return this.session(({ browser }) => this.getStatus(browser), options);
  }

  /**
   * One command session: `plan({ model, status })` returns the forms to post
   * to the control page ("pilotage"), from the status read first when
   * `readFirst` (an alarm command decides on the real zones, not on the last
   * poll). They are posted one after the other, then the status is read again.
   * A plan that throws posts nothing.
   * @returns {Promise<{ before?: object, after: object, forms: object[] }>}
   */
  control(plan, { readFirst = false, ...options } = {}) {
    return this.session(async ({ browser, model, pages }) => {
      const before = readFirst ? await this.getStatus(browser) : undefined;
      const forms = plan({ model, status: before });
      for (const [index, form] of forms.entries()) {
        if (index > 0) {
          await this.sleep(TIMINGS.betweenCommands);
        }
        const page = this.check(await browser.post(pages.pilotage, form), pages);
        if (page.path === pages.default) {
          throw new PanelError('session_lost', 'Redirected to the default page: not logged in');
        }
      }
      return { before, after: await this.getStatus(browser), forms };
    }, options);
  }

  /** Clears fault memories ("Effacer" Piles / Alarmes / Liaisons), then reads the status. */
  resetFaults(faults, options) {
    return this.session(async ({ browser, model }) => {
      const { prefix, pages } = this.detected;
      for (const [index, fault] of faults.entries()) {
        if (index > 0) {
          await this.sleep(TIMINGS.betweenCommands);
        }
        const form = model.forms.resetFault[fault];
        const candidates = elementsPages(model, prefix);
        for (const [rank, path] of candidates.entries()) {
          try {
            this.check(await browser.post(path, form), pages);
            break;
          } catch (err) {
            // Only a missing page is retried elsewhere: a refused form was not applied.
            if (!(err.kind === 'http' && err.status === 404) || rank === candidates.length - 1) {
              throw err;
            }
          }
        }
      }
      return this.getStatus(browser);
    }, options);
  }

  // --- Card import -----------------------------------------------------------

  /** Step 1: the cell the panel asks, and the browser that read it (kept for step 2). */
  async beginImport() {
    const { model } = await this.detect();
    const browser = this.browserFor(model);
    const cell = await this.challenge(browser);
    return { cell, browser, model };
  }

  /**
   * Step 2: login with the code of that cell (no new login page: the panel
   * would ask another cell), read the card print page, log out.
   */
  async finishImport({ cell, browser, model }, { key, adminCode }) {
    const { pages } = this.detected;
    const admin = model.cardAccount === 'a';
    if (admin && !adminCode) {
      throw new PanelError('admin_code', 'This panel shows the card to the administrator only');
    }
    await this.postLogin(browser, {
      cell,
      key,
      account: model.cardAccount,
      password: admin ? adminCode : this.config.userCode,
    });
    try {
      const page = this.check(await browser.get(pages.card), pages);
      const codes = parseCardPage(page.text, model);
      if (!codes) {
        throw new PanelError('card_page', 'The card page does not hold 30 codes');
      }
      return codes;
    } finally {
      await browser.get(pages.logout).catch(() => undefined);
    }
  }
}

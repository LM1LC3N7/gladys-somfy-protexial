// -----------------------------------------------------------------------------
// The only network access: plain HTTP(S) requests to the panel (node:http),
// and a small "browser" on top of it, one per panel session: cookies kept
// from every answer, redirections followed by hand (the final path tells an
// error page or a lost session apart), forms encoded in the page encoding.
// -----------------------------------------------------------------------------

import http from 'node:http';
import https from 'node:https';
import { LIMITS, TIMINGS } from './constants.js';

export class PanelError extends Error {
  /**
   * @param {string} kind network, timeout, http, size, unavailable, not_detected,
   *   no_challenge, card_missing, wrong_code, wrong_credentials, max_attempts, busy,
   *   not_authorized, access_rights, unknown_parameter, bad_parameter, unexpected,
   *   session_lost, bad_status, empty_status, card_page, no_url, no_code, admin_code
   */
  constructor(kind, message, details = {}) {
    super(message);
    this.name = 'PanelError';
    this.kind = kind;
    Object.assign(this, details);
  }
}

// --- Encodings ---------------------------------------------------------------

/** ISO-8859-15 differs from ISO-8859-1 on eight code points. */
const LATIN9_TO_UNICODE = {
  0xa4: 0x20ac,
  0xa6: 0x160,
  0xa8: 0x161,
  0xb4: 0x17d,
  0xb8: 0x17e,
  0xbc: 0x152,
  0xbd: 0x153,
  0xbe: 0x178,
};
const UNICODE_TO_LATIN9 = Object.fromEntries(
  Object.entries(LATIN9_TO_UNICODE).map(([byte, code]) => [code, Number(byte)]),
);

export function decode(buffer, encoding) {
  if (encoding === 'utf8') {
    return new TextDecoder('utf-8').decode(buffer);
  }
  let text = '';
  for (const byte of buffer) {
    text += String.fromCharCode(LATIN9_TO_UNICODE[byte] ?? byte);
  }
  return text;
}

export function encode(text, encoding) {
  if (encoding === 'utf8') {
    return Buffer.from(text, 'utf8');
  }
  const bytes = [];
  for (const char of text) {
    const code = char.codePointAt(0);
    const mapped = UNICODE_TO_LATIN9[code];
    if (mapped !== undefined) {
      bytes.push(mapped);
    } else if (code < 0x100 && LATIN9_TO_UNICODE[code] === undefined) {
      bytes.push(code);
    } else {
      bytes.push(0x3f); // "?" like a browser would for a character the page cannot hold
    }
  }
  return Buffer.from(bytes);
}

const SAFE = /[A-Za-z0-9_.~-]/;

/** application/x-www-form-urlencoded, as Python's urlencode(encoding=…) writes it. */
export function encodeForm(form, encoding) {
  const component = (value) => {
    let out = '';
    for (const byte of encode(String(value), encoding)) {
      const char = String.fromCharCode(byte);
      if (byte < 0x80 && SAFE.test(char)) {
        out += char;
      } else if (byte === 0x20) {
        out += '+';
      } else {
        out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
      }
    }
    return out;
  };
  return Object.entries(form)
    .map(([key, value]) => `${component(key)}=${component(value)}`)
    .join('&');
}

/** The other way round, for the fake panel of the tests. */
export function decodeForm(body, encoding) {
  const form = {};
  for (const pair of body.split('&')) {
    if (pair === '') continue;
    const [rawKey, rawValue = ''] = pair.split('=');
    const bytes = (raw) => {
      const out = [];
      const text = raw.replace(/\+/g, ' ');
      for (let i = 0; i < text.length; i += 1) {
        if (text[i] === '%' && /^[0-9a-f]{2}$/i.test(text.slice(i + 1, i + 3))) {
          out.push(parseInt(text.slice(i + 1, i + 3), 16));
          i += 2;
        } else {
          out.push(text.charCodeAt(i));
        }
      }
      return Buffer.from(out);
    };
    form[decode(bytes(rawKey), encoding)] = decode(bytes(rawValue), encoding);
  }
  return form;
}

// --- Transport ---------------------------------------------------------------

/**
 * One request, settled once: `{ status, headers, body: Buffer }`. Never follows
 * redirections (the browser below does).
 */
export function nodeTransport({
  timeout = TIMINGS.requestTimeout,
  maxBytes = LIMITS.maxBodyBytes,
} = {}) {
  return ({ method, url, headers = {}, body }) =>
    new Promise((resolve, reject) => {
      let settled = false;
      const settle = (fn, value) => {
        if (!settled) {
          settled = true;
          fn(value);
        }
      };
      const target = new URL(url);
      const lib = target.protocol === 'https:' ? https : http;
      const request = lib.request(
        target,
        {
          method,
          headers: { ...headers, ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}) },
          timeout,
        },
        (response) => {
          const chunks = [];
          let size = 0;
          response.on('data', (chunk) => {
            size += chunk.length;
            if (size > maxBytes) {
              request.destroy();
              settle(reject, new PanelError('size', `Answer bigger than ${maxBytes} bytes`));
              return;
            }
            chunks.push(chunk);
          });
          response.on('end', () =>
            settle(resolve, {
              status: response.statusCode,
              headers: response.headers,
              body: Buffer.concat(chunks),
            }),
          );
          response.on('error', (err) =>
            settle(reject, new PanelError('network', `Answer interrupted: ${err.message}`)),
          );
        },
      );
      request.on('timeout', () => {
        request.destroy();
        settle(reject, new PanelError('timeout', `No answer within ${timeout / 1000} s`));
      });
      request.on('error', (err) =>
        settle(reject, new PanelError('network', `${err.code ?? 'Network error'}: ${err.message}`)),
      );
      request.end(body);
    });
}

// --- Browser -----------------------------------------------------------------

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/** A panel session: base URL, cookies, encoding. */
export class Browser {
  constructor({ baseUrl, transport, encoding = 'latin9' }) {
    this.baseUrl = baseUrl;
    this.transport = transport;
    this.encoding = encoding;
    this.cookies = new Map();
  }

  keepCookies(headers) {
    const raw = headers['set-cookie'];
    for (const line of Array.isArray(raw) ? raw : raw ? [raw] : []) {
      const [pair] = line.split(';');
      const index = pair.indexOf('=');
      if (index > 0) {
        this.cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
      }
    }
  }

  cookieHeader() {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  async send(method, path, { form, follow = true } = {}) {
    let url = new URL(path, this.baseUrl).toString();
    let body = form ? encodeForm(form, this.encoding) : undefined;
    for (let hop = 0; ; hop += 1) {
      const headers = { Accept: 'text/html,application/xhtml+xml,application/xml,*/*' };
      const cookie = this.cookieHeader();
      if (cookie) headers.Cookie = cookie;
      if (body !== undefined) headers['Content-Type'] = 'application/x-www-form-urlencoded';
      const response = await this.transport({ method, url, headers, body });
      this.keepCookies(response.headers ?? {});
      const location = response.headers?.location;
      if (follow && REDIRECTS.has(response.status) && location) {
        if (hop >= LIMITS.maxRedirects) {
          throw new PanelError('http', 'Too many redirections');
        }
        url = new URL(location, url).toString();
        // Like a browser: a POST answered 301/302/303 goes on as a GET.
        if (response.status !== 307 && response.status !== 308) {
          method = 'GET';
          body = undefined;
        }
        continue;
      }
      return {
        status: response.status,
        headers: response.headers ?? {},
        path: new URL(url).pathname,
        location,
        body: response.body,
        text: decode(response.body ?? Buffer.alloc(0), this.encoding),
      };
    }
  }

  get(path, options) {
    return this.send('GET', path, options);
  }

  post(path, form, options) {
    return this.send('POST', path, { ...options, form });
  }
}

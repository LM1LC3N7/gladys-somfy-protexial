// -----------------------------------------------------------------------------
// Reading the pages of the panel (pure functions): the cell asked at login,
// the error code of the error page, the year in the footer, status.xml and
// the card print page.
// -----------------------------------------------------------------------------

import { cardFromCells } from './card.js';
import { CHALLENGE_REGEX, SOMFY_ERRORS } from './constants.js';
import { decodeEntities, parseHtml, select, selectText, textOf } from './html.js';
import { PanelError } from './http.js';

/** The cell asked at login (`B1`), or undefined when the page has none. */
export function parseChallenge(html, model) {
  const text = selectText(parseHtml(html), model.selectors.challenge);
  return text.match(CHALLENGE_REGEX)?.[0];
}

/** `(0x0B00)` from the error page, or undefined. */
export function parseErrorCode(html, model) {
  const root = parseHtml(html);
  const pattern = /\(0x[0-9a-f]{4}\)/i;
  const code =
    selectText(root, model.selectors.error).match(pattern)?.[0] ?? textOf(root).match(pattern)?.[0];
  return code ? `(0x${code.slice(3, 7).toUpperCase()})` : undefined;
}

/** The kind of a Somfy error code (`wrong_code`, `busy`…), `unexpected` for an unknown one. */
export const errorKind = (code) => SOMFY_ERRORS[code] ?? 'unexpected';

/** The year of the interface ("Copyright ©2010 Somfy" -> "2010"). */
export function parseFooterYear(html, model) {
  const root = parseHtml(html);
  return (
    selectText(root, model.selectors.footer).match(/(\d{4})\s*somfy/i)?.[1] ??
    textOf(root).match(/(?:©|\(c\)|copyright)\s*(\d{4})/i)?.[1]
  );
}

/** Python's `string.printable` filter then lower case, as the reference compares values. */
export const asciiLower = (value) =>
  [...String(value ?? '')]
    .filter((char) => {
      const code = char.charCodeAt(0);
      return (code >= 0x20 && code <= 0x7e) || (code >= 0x09 && code <= 0x0d);
    })
    .join('')
    .toLowerCase();

const withoutAccents = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

/** A fault flag: `true` = fault, `false` = ok, `undefined` when the panel gave nothing. */
const fault = (value) =>
  value === undefined || value === '' ? undefined : asciiLower(value).trim() !== 'ok';

/**
 * status.xml -> the state of the panel.
 *
 * zone0..zone2: zones A, B, C (`on` = armed); defaut0 batteries, defaut1 radio
 * link, defaut2 door or window open, defaut3 alarm (intrusion detected,
 * latched until cleared), defaut4 box tamper; `ok` when fine. gsm, recgsm
 * (signal 0-5), opegsm (operator), camera (`enabled`): only on some panels.
 */
export function parseStatus(xml) {
  const values = {};
  for (const [, tag, value] of String(xml).matchAll(/<([a-z]\w*)\s*>([^<]*)<\/\1\s*>/gi)) {
    values[tag.toLowerCase()] = decodeEntities(value).trim();
  }
  for (const [, tag] of String(xml).matchAll(/<([a-z]\w*)\s*\/>/gi)) {
    values[tag.toLowerCase()] ??= '';
  }
  if (!['zone0', 'zone1', 'zone2'].every((tag) => tag in values)) {
    throw new PanelError('bad_status', 'status.xml without zones');
  }
  const gsmText = values.gsm;
  const signal = Number.parseInt(values.recgsm, 10);
  const status = {
    zones: {
      A: asciiLower(values.zone0).trim() === 'on',
      B: asciiLower(values.zone1).trim() === 'on',
      C: asciiLower(values.zone2).trim() === 'on',
    },
    battery: fault(values.defaut0),
    radio: fault(values.defaut1),
    door: fault(values.defaut2),
    alarm: fault(values.defaut3),
    box: fault(values.defaut4),
    gsm:
      gsmText === undefined
        ? undefined
        : {
            text: gsmText,
            // "GSM connecté au réseau": the reference compares its ASCII-filtered form.
            connected:
              asciiLower(gsmText).trim() === 'gsm connect au rseau' ||
              withoutAccents(gsmText) === 'gsm connecte au reseau',
          },
    signal:
      'recgsm' in values && Number.isFinite(signal) ? Math.max(0, Math.min(5, signal)) : undefined,
    operator:
      'opegsm' in values
        ? values.opegsm.replace(/^["']+|["']+$/g, '').trim() || undefined
        : undefined,
    camera: 'camera' in values ? asciiLower(values.camera).trim() === 'enabled' : undefined,
  };
  // A known firmware bug answers status.xml with every field empty: the
  // reference checks the alarm flag (defaut3) for it.
  status.empty = status.alarm === undefined;
  return status;
}

/** The zones armed, `['A', 'C']`. */
export const armedZones = (status) => ['A', 'B', 'C'].filter((zone) => status?.zones?.[zone]);

/** The 30 codes of the card print page, or undefined when it does not look like one. */
export function parseCardPage(html, model) {
  const cells = select(parseHtml(html), model.selectors.card).map(textOf);
  return cardFromCells(cells);
}

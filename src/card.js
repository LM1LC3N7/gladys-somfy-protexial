// -----------------------------------------------------------------------------
// The authentication card ("carte d'authentification"): the printed grid of
// 30 codes (columns A to F, rows 1 to 5) delivered with the panel. At each
// login the panel asks for the code of one cell ("Code d'authentification B1").
//
// Two ways to give it, both stored in the `auth_card` secret field:
// - labelled: `A1=1234 B1=5678 …` (any order, `=`, `:` or a space between);
// - the 30 codes alone, read row by row, left to right: A1 B1 C1 D1 E1 F1,
//   then A2 … F2, down to F5 (the order of the card and of its print page).
// -----------------------------------------------------------------------------

import { CARD_CELLS } from './constants.js';

const LABELLED = /\b([A-Fa-f])\s*([1-5])\s*[:=]?\s*(\d{3,8})\b/g;
const CODE = /\d{3,8}/g;

/** `{ A1: '1234', … }` -> `A1=1234 B1=5678 …` in card order, the stored form. */
export function formatCard(codes) {
  return CARD_CELLS.filter((cell) => codes[cell] !== undefined)
    .map((cell) => `${cell}=${codes[cell]}`)
    .join(' ');
}

/**
 * Reads what the user typed (or what the import stored).
 * @returns {{ codes: Record<string, string>, count: number, missing: string[], text: string,
 *   problem: 'empty'|'count'|undefined }}
 */
export function parseCard(raw) {
  const input = String(raw ?? '').trim();
  const codes = {};
  let problem;
  if (input === '') {
    problem = 'empty';
  } else {
    const labelled = [...input.matchAll(LABELLED)];
    if (labelled.length > 0) {
      for (const [, col, row, code] of labelled) {
        codes[`${col.toUpperCase()}${row}`] = code;
      }
    } else {
      const plain = input.match(CODE) ?? [];
      if (plain.length === CARD_CELLS.length) {
        CARD_CELLS.forEach((cell, index) => {
          codes[cell] = plain[index];
        });
      } else {
        problem = 'count';
      }
    }
  }
  const missing = CARD_CELLS.filter((cell) => codes[cell] === undefined);
  return {
    codes,
    count: CARD_CELLS.length - missing.length,
    missing,
    text: formatCard(codes),
    problem,
  };
}

/** The 30 codes of the card print page, in page order (`td:not([class])`, digits only). */
export function cardFromCells(texts) {
  const values = texts.map((text) => text.trim()).filter((text) => /^\d{3,8}$/.test(text));
  if (values.length !== CARD_CELLS.length) {
    return undefined;
  }
  return Object.fromEntries(CARD_CELLS.map((cell, index) => [cell, values[index]]));
}

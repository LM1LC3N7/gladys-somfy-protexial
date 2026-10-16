import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardFromCells, formatCard, parseCard } from '../src/card.js';
import { CARD_CELLS } from '../src/constants.js';
import { CARD, CARD_TYPED } from './fixtures/pages.js';

test('the 30 codes typed row by row: A1 B1 … F1, A2 … F5', () => {
  const card = parseCard(CARD_TYPED);
  assert.equal(card.count, 30);
  assert.deepEqual(card.codes, CARD);
  assert.deepEqual(card.missing, []);
  assert.equal(card.problem, undefined);
  // Any separator: new lines (one row per line), commas, semicolons.
  const rows = [0, 1, 2, 3, 4]
    .map((row) =>
      CARD_CELLS.slice(row * 6, row * 6 + 6)
        .map((cell) => CARD[cell])
        .join(', '),
    )
    .join('\n');
  assert.deepEqual(parseCard(rows).codes, CARD);
});

test('labelled codes, in any order and case, are the stored form', () => {
  const text = formatCard(CARD);
  assert.match(text, /^A1=\d{4} B1=\d{4} .* F5=\d{4}$/);
  assert.deepEqual(parseCard(text).codes, CARD);
  const mixed = parseCard('f5: 1111, a1 2222\nC3=3333');
  assert.deepEqual(mixed.codes, { A1: '2222', C3: '3333', F5: '1111' });
  assert.equal(mixed.count, 3);
  assert.equal(mixed.missing.length, 27);
  assert.equal(mixed.text, 'A1=2222 C3=3333 F5=1111');
});

test('empty, or the wrong number of unlabelled codes', () => {
  assert.equal(parseCard('').problem, 'empty');
  assert.equal(parseCard(undefined).problem, 'empty');
  const short = parseCard(CARD_TYPED.split(' ').slice(0, 29).join(' '));
  assert.equal(short.problem, 'count');
  assert.equal(short.count, 0);
});

test('the card print page cells: digits only, exactly 30', () => {
  const cells = ['', 'A', '1', ...CARD_CELLS.map((cell) => ` ${CARD[cell]} `), '2'];
  assert.deepEqual(cardFromCells(cells), CARD);
  assert.equal(cardFromCells(cells.slice(0, 20)), undefined);
});

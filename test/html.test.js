import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeEntities, parseHtml, select, selectText, textOf } from '../src/html.js';

const PAGE = `<!DOCTYPE html>
<html><head><title>T&eacute;st</title>
<script>var a = "<td>not a cell</td>";</script>
<style>td { color: red }</style>
</head>
<body>
<!-- <b>commented</b> -->
<div id="menu_footer2">Copyright &copy;2010 Somfy</div>
<form id="form_id">
<input type="hidden" name="hidden" value="hidden">
<div>one</div><div>two</div><div class="x">three <b>B</b></div>
<table>
<tr><td>r1<td class="c">r1c2
<tr><td>r2 <b>X9</b></td><td>r2c2</td></tr>
</table>
<p>open paragraph
<p>second
</form>
<img src="a.png"/>
</body></html>`;

test('entities, comments, scripts and void elements', () => {
  assert.equal(decodeEntities('a&amp;b &#233; &#xE9; &unknown; &copy;'), 'a&b é é &unknown; ©');
  const root = parseHtml(PAGE);
  assert.equal(selectText(root, 'title'), 'Tést');
  assert.equal(select(root, 'b').length, 2, 'the commented <b> and the script are not elements');
  assert.equal(select(root, 'td').length, 4, 'nothing from the script string');
  assert.equal(select(root, 'img').length, 1);
});

test('implied end tags: td, tr and p close their open siblings', () => {
  const root = parseHtml(PAGE);
  const rows = select(root, 'tr');
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row) => row.children.filter((c) => c.tag).length),
    [2, 2],
  );
  assert.deepEqual(select(root, 'p').map(textOf), ['open paragraph', 'second']);
});

test('the selectors of the reference: #id, descendant, nth-child, ^=, :not([attr])', () => {
  const root = parseHtml(PAGE);
  assert.equal(selectText(root, "[id^='menu_footer']"), 'Copyright ©2010 Somfy');
  assert.equal(selectText(root, '#form_id td b'), 'X9');
  // input (1), div (2), div (3), div.x (4): nth-child counts every element sibling.
  assert.equal(selectText(root, '#form_id div:nth-child(4) b'), 'B');
  assert.equal(selectText(root, '#form_id div:nth-child(3)'), 'two');
  assert.equal(selectText(root, '#form_id table tr:nth-child(2) td:nth-child(1) b'), 'X9');
  assert.deepEqual(select(root, 'td:not([class])').map(textOf), ['r1', 'r2 X9', 'r2c2']);
  assert.equal(selectText(root, '.x'), 'three B');
  assert.equal(selectText(root, '#nothing b'), '');
  assert.throws(() => select(root, 'div > b'), /Unsupported selector/);
});

test('unquoted and boolean attributes, stray end tags', () => {
  const root = parseHtml('<p><input type=checkbox checked name=a></span></p><div id=z>ok</div>');
  const [input] = select(root, 'input');
  assert.deepEqual(input.attrs, { type: 'checkbox', checked: '', name: 'a' });
  assert.equal(selectText(root, '#z'), 'ok');
});

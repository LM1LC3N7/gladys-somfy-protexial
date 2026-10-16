// -----------------------------------------------------------------------------
// A small, forgiving HTML reader for the pages of the panel, and the handful
// of CSS selectors the reference integration (pyquery) uses on them:
// `#id`, `tag`, `[attr]`, `[attr^='x']`, `[attr='x']`, `:nth-child(n)`,
// `:not([attr])` and the descendant combinator. Enough for these old,
// hand-written pages; not a general HTML parser.
// -----------------------------------------------------------------------------

const VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title']);
/**
 * Opening one of these closes the nearest open element of the listed tags,
 * with everything opened inside it (implied end tags: `<tr>` closes the open
 * row and its cell).
 */
const IMPLIED_END = {
  td: ['td', 'th'],
  th: ['td', 'th'],
  tr: ['tr'],
  li: ['li'],
  option: ['option'],
  p: ['p'],
};
/** ...but never past these. */
const SCOPE = {
  td: ['tr', 'table'],
  th: ['tr', 'table'],
  tr: ['table', 'tbody', 'thead', 'tfoot'],
  li: ['ul', 'ol'],
  option: ['select'],
  p: ['div', 'td', 'body', 'form'],
};

const ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  copy: '©',
  eacute: 'é',
  egrave: 'è',
  ecirc: 'ê',
  agrave: 'à',
  acirc: 'â',
  ccedil: 'ç',
  ocirc: 'ô',
  ucirc: 'û',
  ugrave: 'ù',
  icirc: 'î',
  iuml: 'ï',
  euml: 'ë',
  auml: 'ä',
  ouml: 'ö',
  uuml: 'ü',
  szlig: 'ß',
  Eacute: 'É',
  deg: '°',
  euro: '€',
};

export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, name) => {
    if (name[0] === '#') {
      const code =
        name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1));
      return Number.isFinite(code) && code > 0 && code < 0x110000
        ? String.fromCodePoint(code)
        : match;
    }
    return ENTITIES[name] ?? match;
  });
}

const ATTRIBUTE = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

function parseAttributes(source) {
  const attrs = {};
  for (const [, name, double, single, bare] of source.matchAll(ATTRIBUTE)) {
    attrs[name.toLowerCase()] = decodeEntities(double ?? single ?? bare ?? '');
  }
  return attrs;
}

const element = (tag, attrs, parent) => ({ tag, attrs, parent, children: [] });

/** HTML text -> a tree of `{ tag, attrs, children, parent }` and `{ text }` nodes. */
export function parseHtml(html) {
  const root = element('#root', {}, null);
  const stack = [root];
  const current = () => stack[stack.length - 1];
  const TOKEN =
    /<!--[\s\S]*?-->|<![^>]*>|<\?[^>]*>|<\/\s*([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let last = 0;
  const addText = (text) => {
    if (text !== '') {
      current().children.push({ text: decodeEntities(text) });
    }
  };
  let match;
  while ((match = TOKEN.exec(html)) !== null) {
    addText(html.slice(last, match.index));
    last = TOKEN.lastIndex;
    const [, closing, opening, rest = ''] = match;
    if (closing) {
      const tag = closing.toLowerCase();
      const index = stack.map((node) => node.tag).lastIndexOf(tag);
      if (index > 0) {
        stack.length = index;
      }
      continue;
    }
    if (!opening) {
      continue; // comment, doctype, processing instruction
    }
    const tag = opening.toLowerCase();
    const implied = IMPLIED_END[tag];
    if (implied) {
      for (let i = stack.length - 1; i > 0; i -= 1) {
        if (SCOPE[tag].includes(stack[i].tag)) {
          break;
        }
        if (implied.includes(stack[i].tag)) {
          stack.length = i;
          break;
        }
      }
    }
    const node = element(tag, parseAttributes(rest), current());
    current().children.push(node);
    if (VOID.has(tag) || /\/\s*$/.test(rest)) {
      continue;
    }
    if (RAW_TEXT.has(tag)) {
      const end = new RegExp(`</\\s*${tag}\\s*>`, 'ig');
      end.lastIndex = last;
      const close = end.exec(html);
      const stop = close ? close.index : html.length;
      if (stop > last) {
        node.children.push({ text: tag === 'title' ? decodeEntities(html.slice(last, stop)) : '' });
      }
      last = close ? end.lastIndex : html.length;
      TOKEN.lastIndex = last;
      continue;
    }
    stack.push(node);
  }
  addText(html.slice(last));
  return root;
}

/** The text of a node, whitespace collapsed (like pyquery's `.text()`). */
export function textOf(node) {
  const parts = [];
  const walk = (n) => {
    if (n.text !== undefined) {
      parts.push(n.text);
    } else {
      n.children.forEach(walk);
    }
  };
  walk(node);
  return parts.join('').replace(/\s+/g, ' ').trim();
}

const elementChildren = (node) => node.children.filter((child) => child.tag !== undefined);

function parseCompound(source) {
  const compound = { tag: undefined, attrs: [], nth: undefined, not: [] };
  const PART =
    /^([a-zA-Z][\w-]*|\*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:([\^$*]?=)['"]?([^'"\]]*)['"]?)?\]|:nth-child\((\d+)\)|:not\(\[([\w-]+)\]\)/g;
  let rest = source;
  for (const [all, tag, id, cls, attr, op, value, nth, not] of source.matchAll(PART)) {
    rest = rest.replace(all, '');
    if (tag && tag !== '*') {
      compound.tag = tag.toLowerCase();
    } else if (id) {
      compound.attrs.push({ name: 'id', op: '=', value: id });
    } else if (cls) {
      compound.attrs.push({ name: 'class', op: '~=', value: cls });
    } else if (attr) {
      compound.attrs.push({ name: attr.toLowerCase(), op, value });
    } else if (nth) {
      compound.nth = Number(nth);
    } else if (not) {
      compound.not.push(not.toLowerCase());
    }
  }
  if (rest.trim() !== '') {
    throw new Error(`Unsupported selector part: ${rest}`);
  }
  return compound;
}

function matches(node, compound) {
  if (node.tag === undefined || node.tag === '#root') {
    return false;
  }
  if (compound.tag && node.tag !== compound.tag) {
    return false;
  }
  for (const { name, op, value } of compound.attrs) {
    const actual = node.attrs[name];
    if (actual === undefined) {
      return false;
    }
    if (op === '=' && actual !== value) return false;
    if (op === '^=' && !actual.startsWith(value)) return false;
    if (op === '$=' && !actual.endsWith(value)) return false;
    if (op === '*=' && !actual.includes(value)) return false;
    if (op === '~=' && !actual.split(/\s+/).includes(value)) return false;
  }
  if (compound.not.some((name) => node.attrs[name] !== undefined)) {
    return false;
  }
  if (compound.nth !== undefined) {
    const siblings = node.parent ? elementChildren(node.parent) : [node];
    if (siblings.indexOf(node) + 1 !== compound.nth) {
      return false;
    }
  }
  return true;
}

function descendants(node, out = []) {
  for (const child of elementChildren(node)) {
    out.push(child);
    descendants(child, out);
  }
  return out;
}

/** Every element matching `selector` (descendant combinators only), in document order. */
export function select(root, selector) {
  const compounds = selector.trim().split(/\s+/).map(parseCompound);
  let scope = [root];
  for (const compound of compounds) {
    const found = new Set();
    for (const node of scope) {
      for (const candidate of descendants(node)) {
        if (matches(candidate, compound)) {
          found.add(candidate);
        }
      }
    }
    // Back to document order, without duplicates.
    scope = descendants(root).filter((node) => found.has(node));
  }
  return scope;
}

/** The text of every match, joined by a space (pyquery `.text()` on a selection). */
export const selectText = (root, selector) =>
  select(root, selector)
    .map(textOf)
    .filter((text) => text !== '')
    .join(' ');

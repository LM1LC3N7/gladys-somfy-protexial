// -----------------------------------------------------------------------------
// Pages of the four web interfaces, as the panel serves them.
//
// Shaped after the reference integration AuroreVgn/somfy-protexial 2.2.1
// (MIT, (c) 2021 the8tre): the selectors, form fields, page paths and
// encodings of protexial_api.py, protexial_io_api.py, protexiom_api.py and
// protexiom_alt_api.py, the status.xml tags and values read by protexial.py
// and const.py, and the login screenshots of its README (assets/welcome.png:
// Protexial ©2010; assets/login_io.jpeg: Protexial IO ©2014). The reference
// ships no page dumps: the markup around the selectors is ours, the codes and
// the card are made up.
// -----------------------------------------------------------------------------

import { CARD_CELLS } from '../../src/constants.js';

/** A made-up authentication card: 30 four-digit codes. */
export const CARD = Object.fromEntries(
  CARD_CELLS.map((cell, index) => [cell, String(1000 + ((index * 7919) % 9000)).padStart(4, '0')]),
);

/** The 30 codes as typed by hand, row by row. */
export const CARD_TYPED = CARD_CELLS.map((cell) => CARD[cell]).join(' ');

const head = (charset, title) => `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN">
<html>
<head>
<meta http-equiv="content-type" content="text/html; charset=${charset}">
<title>${title}</title>
<link rel="stylesheet" type="text/css" href="/style.css">
</head>`;

const accounts = (admin) => `<select name="login">
<option value="u" selected>Utilisateur1</option>
${admin ? '<option value="a">Administrateur</option>\n' : ''}<option value="i">Installateur</option>
</select>`;

/** Login pages: the one place the four interfaces really differ. */
export function loginPage(model, { cell = 'B1', year = '2010', prefix = 'fr' } = {}) {
  switch (model) {
    case 'protexial':
      return `${head('iso-8859-15', 'Bienvenue')}
<body>
<div id="page">
<div id="menu"><img src="/img/logo.png" alt="Somfy">
<div id="menu_footer2">Copyright &copy;${year} Somfy</div>
</div>
<div id="content">
<h1>Bienvenue</h1>
<p class="intro">Mon système d'alarme Somfy</p>
<form id="form_id" name="form_id" method="post" action="/${prefix}/login.htm">
<table class="login">
<tr><td class="label">Compte</td><td>${accounts(false)}</td></tr>
<tr><td class="label">Code d'acc&egrave;s</td><td><input type="password" name="password" maxlength="4"></td></tr>
<tr><td class="label">Code d'authentification <b>${cell}</b></td><td><input type="password" name="key" maxlength="4"></td></tr>
</table>
<div class="button"><input type="submit" name="btn_login" value="Connexion"></div>
</form>
</div>
</div>
</body>
</html>
`;
    case 'protexial_io':
      return `<!DOCTYPE html>
<html>
<head><meta http-equiv="content-type" content="text/html; charset=utf-8"><title>Protexial iO</title></head>
<body>
<div class="box">
<div class="brand">SECURITY SYSTEM <span>Protexial iO</span></div>
<form id="form_id" method="post" action="/${prefix}/login.htm">
<input type="hidden" name="hidden" value="hidden">
<div class="label">Compte</div>
<div class="field">${accounts(false)}</div>
<div class="label">Code d'accès</div>
<div class="field"><input type="password" name="password"></div>
<div class="label">Code d'authentification <b>${cell}</b></div>
<div class="field"><input type="password" name="key"></div>
<div class="button"><input type="submit" name="btn_login" value="Se connecter"></div>
</form>
<p class="copyright">Copyright ©${year} Somfy SAS - IDDN.FR.001.300010.000.D.P.2014.000.41100<br>
All rights reserved.</p>
</div>
<div class="flags"><a href="/gb/login.htm"><img src="/img/gb.png"></a><a href="/fr/login.htm"><img src="/img/fr.png"></a></div>
</body>
</html>
`;
    case 'protexiom':
    case 'protexiom_alt': {
      const label =
        model === 'protexiom'
          ? `Code d'authentification <b>${cell}</b>`
          : `Code d'authentification ${cell}`;
      return `${head('iso-8859-15', 'Protexiom')}
<body>
<div id="page">
<div id="menu"><div id="menu_footer">&copy; ${year} Somfy</div></div>
<form id="form_id" method="post" action="/login.htm">
<table>
<tr><td colspan="2"><h2>Identification</h2></td></tr>
<tr><td>Compte</td><td>${accounts(model === 'protexiom_alt')}</td></tr>
<tr><td>Code d'acc&egrave;s</td><td><input type="password" name="password" maxlength="4"></td></tr>
<tr><td>${label}</td><td><input type="password" name="key" maxlength="4"></td></tr>
<tr><td colspan="2"><input type="submit" name="action" value="Connexion"></td></tr>
</table>
</form>
</div>
</body>
</html>
`;
    }
    default:
      throw new Error(`Unknown model ${model}`);
  }
}

export function errorPage(model, code, text = 'Erreur') {
  const button =
    model === 'protexiom' || model === 'protexiom_alt'
      ? '<input type="submit" name="action" value="OK">'
      : '<input type="submit" name="btn_ok" value="OK">';
  return `${head(model === 'protexial_io' ? 'utf-8' : 'iso-8859-15', 'Erreur')}
<body>
<div id="page">
<div id="infobox" class="error"><b>${code}</b><br>${text}</div>
<form method="post">${button}</form>
</div>
</body>
</html>
`;
}

export function pilotagePage(model) {
  return `${head(model === 'protexial_io' ? 'utf-8' : 'iso-8859-15', 'Pilotage')}
<body>
<div id="page"><h1>Pilotage</h1>
<form method="post"><input type="hidden" name="hidden" value="hidden"></form>
</div>
</body>
</html>
`;
}

/** The card print page: a header row, then 5 rows of a row label and 6 codes. */
export function cardPage(model, codes = CARD) {
  const header = `<tr><td class="corner"></td>${['A', 'B', 'C', 'D', 'E', 'F']
    .map((col) => `<td class="col">${col}</td>`)
    .join('')}</tr>`;
  const rows = [1, 2, 3, 4, 5]
    .map(
      (row) =>
        `<tr><td class="row">${row}</td>${['A', 'B', 'C', 'D', 'E', 'F']
          .map((col) => `<td>${codes[`${col}${row}`]}</td>`)
          .join('')}</tr>`,
    )
    .join('\n');
  return `${head(model === 'protexial_io' ? 'utf-8' : 'iso-8859-15', 'Carte')}
<body>
<div id="page"><h1>Carte d'authentification</h1>
<table class="card">
${header}
${rows}
</table>
<input type="button" class="print" value="Imprimer" onclick="window.print()">
</div>
</body>
</html>
`;
}

/**
 * status.xml. `state` = { zones: {A,B,C}, faults: {battery, radio, door, alarm,
 * box}, gsm, signal, operator, camera } (fault true = not ok); `null` gsm or
 * camera leave the tag out, `empty` answers every field empty (firmware bug).
 */
export function statusXml(state, { empty = false } = {}) {
  const value = (v) => (empty ? '' : v);
  const fault = (on, nok = 'nok') => value(on ? nok : 'ok');
  const lines = [
    '<?xml version="1.0" encoding="ISO-8859-15"?>',
    '<response>',
    `<zone0>${value(state.zones.A ? 'on' : 'off')}</zone0>`,
    `<zone1>${value(state.zones.B ? 'on' : 'off')}</zone1>`,
    `<zone2>${value(state.zones.C ? 'on' : 'off')}</zone2>`,
    `<defaut0>${fault(state.faults.battery)}</defaut0>`,
    `<defaut1>${fault(state.faults.radio)}</defaut1>`,
    `<defaut2>${fault(state.faults.door)}</defaut2>`,
    `<defaut3>${fault(state.faults.alarm, 'nok_int')}</defaut3>`,
    `<defaut4>${fault(state.faults.box)}</defaut4>`,
  ];
  if (state.gsm !== null) {
    lines.push(`<gsm>${value(state.gsm ? 'GSM connecté au réseau' : 'GSM non connecté')}</gsm>`);
    lines.push(`<recgsm>${value(String(state.signal))}</recgsm>`);
    lines.push(`<opegsm>${value(`"${state.operator}"`)}</opegsm>`);
  }
  if (state.camera !== null) {
    lines.push(`<camera>${value(state.camera ? 'enabled' : 'disabled')}</camera>`);
  }
  lines.push('</response>', '');
  return lines.join('\n');
}

// -----------------------------------------------------------------------------
// The four web interfaces of the panels, as the reference integration
// (AuroreVgn/somfy-protexial 2.2.1, MIT, protexial_api.py, protexial_io_api.py,
// protexiom_api.py, protexiom_alt_api.py) tells them apart: page paths, the
// selector of the cell asked at login, the encoding and the form fields.
//
// - protexial:     Protexial 2008-2013 (v7_9, v8_1, v10_13-v10_15…), pages
//                  under /fr/ (or /de/, /gb/… for a panel set in another
//                  language), ISO-8859-15, version at /cfg/vers;
// - protexial_io:  Protexial IO (v10_13, v10_14), same paths, UTF-8, a
//                  div-based login form;
// - protexiom:     Protexiom 2008-2013 (incl. 5000 / 600), pages at the root,
//                  ISO-8859-15, no version page;
// - protexiom_alt: Protexiom variant whose login cell is not in bold and whose
//                  card page is reserved to the administrator account ("a").
// -----------------------------------------------------------------------------

const COMMON_SELECTORS = {
  error: '#infobox b',
  footer: "[id^='menu_footer']",
  card: 'td:not([class])',
};

/** Protexial and Protexial IO share these pages (localized under /fr/). */
const PROTEXIAL_PAGES = {
  login: '/fr/login.htm',
  logout: '/logout.htm',
  pilotage: '/fr/u_pilotage.htm',
  status: '/status.xml',
  error: '/fr/error.htm',
  elements: '/fr/u_listelmt.htm',
  card: '/fr/u_print.htm',
  version: '/cfg/vers',
  default: '/default.htm',
};

const PROTEXIOM_PAGES = {
  login: '/login.htm',
  logout: '/logout.htm',
  pilotage: '/u_pilotage.htm',
  status: '/status.xml',
  error: '/error.htm',
  elements: '/u_listelmt.htm',
  card: '/u_print.htm',
  version: null,
  default: '/default.htm',
};

const PROTEXIOM_FORMS = {
  login: (login, password, key) => ({ login, password, key, action: 'Connexion' }),
  resetSession: { action: 'OK' },
  arm: (zones) => ({ hidden: 'hidden', zone: `Marche ${zones.join(' ')}` }),
  disarm: { hidden: 'hidden', zone: 'Arrêt A B C' },
  lightOn: { hidden: 'hidden', action_lum: 'ON' },
  lightOff: { hidden: 'hidden', action_lum: 'OFF' },
  shutterOpen: { hidden: 'hidden', action_vol_montee: '' },
  shutterClose: { hidden: 'hidden', action_vol_descente: '' },
  shutterStop: { hidden: 'hidden', action_vol_stop: '' },
  resetFault: {
    battery: { efface: 'Piles' },
    alarm: { efface: 'Alarmes' },
    link: { efface: 'Liaisons' },
  },
};

const PROTEXIAL_RESET_FAULT = {
  battery: { btn_del_pil: 'Piles' },
  alarm: { btn_del_alm: 'Alarmes' },
  link: { btn_del_lia: 'Liaisons' },
};

export const MODELS = {
  protexial: {
    key: 'protexial',
    name: 'Protexial',
    pages: PROTEXIAL_PAGES,
    selectors: { ...COMMON_SELECTORS, challenge: '#form_id td b' },
    encoding: 'latin9',
    cardAccount: 'u',
    forms: {
      login: (login, password, key) => ({ login, password, key, btn_login: 'Connexion' }),
      resetSession: { btn_ok: 'OK' },
      // One button per zone, "Marche" on each (protexial_api.py).
      arm: (zones) => ({ hidden: 'hidden', [`btn_zone_on_${zones.join('')}`]: 'Marche' }),
      disarm: { hidden: 'hidden', btn_zone_off_ABC: 'Arrêt A B C' },
      lightOn: { hidden: 'hidden', btn_lum_on: 'ON' },
      lightOff: { hidden: 'hidden', btn_lum_off: 'OFF' },
      shutterOpen: { hidden: 'hidden', btn_vol_up: '' },
      shutterClose: { hidden: 'hidden', btn_vol_down: '' },
      shutterStop: { hidden: 'hidden', btn_vol_stop: '' },
      resetFault: PROTEXIAL_RESET_FAULT,
    },
  },
  protexial_io: {
    key: 'protexial_io',
    name: 'Protexial IO',
    pages: { ...PROTEXIAL_PAGES, card: '/fr/u_challenge.htm' },
    selectors: { ...COMMON_SELECTORS, challenge: '#form_id div:nth-child(6) b' },
    encoding: 'utf8',
    cardAccount: 'u',
    forms: {
      login: (login, password, key) => ({ login, password, key, btn_login: 'Se connecter' }),
      resetSession: { btn_ok: 'OK' },
      arm: (zones) => ({
        hidden: 'hidden',
        [`btn_zone_on_${zones.join('')}`]: `Marche ${zones.join(' ')}`,
      }),
      disarm: { hidden: 'hidden', btn_zone_off_ABC: 'Arrêt A B C' },
      lightOn: { hidden: 'hidden', btn_lum_on: 'ON' },
      lightOff: { hidden: 'hidden', btn_lum_off: 'OFF' },
      shutterOpen: { hidden: 'hidden', btn_vol_up: '' },
      shutterClose: { hidden: 'hidden', btn_vol_down: '' },
      shutterStop: { hidden: 'hidden', btn_vol_stop: 'Stop' },
      resetFault: PROTEXIAL_RESET_FAULT,
    },
  },
  protexiom: {
    key: 'protexiom',
    name: 'Protexiom',
    pages: PROTEXIOM_PAGES,
    selectors: {
      ...COMMON_SELECTORS,
      challenge: '#form_id table tr:nth-child(4) td:nth-child(1) b',
    },
    encoding: 'latin9',
    cardAccount: 'u',
    forms: PROTEXIOM_FORMS,
  },
  protexiom_alt: {
    key: 'protexiom_alt',
    name: 'Protexiom (admin card page)',
    pages: { ...PROTEXIOM_PAGES, card: '/a_print.htm' },
    selectors: { ...COMMON_SELECTORS, challenge: '#form_id table tr:nth-child(4) td:nth-child(1)' },
    encoding: 'latin9',
    // The card page of this variant is reserved to the administrator.
    cardAccount: 'a',
    forms: PROTEXIOM_FORMS,
  },
};

export const MODEL_KEYS = Object.keys(MODELS);

/** The order the reference tries them in: the stricter selectors first, the ALT one last. */
export const DETECTION_ORDER = ['protexial_io', 'protexial', 'protexiom', 'protexiom_alt'];

/** The pages of a model for a web interface language (`/fr/…` -> `/de/…`). */
export function localizedPages(model, prefix = 'fr') {
  const pages = {};
  for (const [name, path] of Object.entries(model.pages)) {
    pages[name] =
      typeof path === 'string' && path.startsWith('/fr/') ? `/${prefix}/${path.slice(4)}` : path;
  }
  return pages;
}

/** The pages that answer the "Effacer" forms: localized first, then the root one. */
export function elementsPages(model, prefix = 'fr') {
  const localized = localizedPages(model, prefix).elements;
  return [...new Set([localized, `/${localized.split('/').pop()}`])];
}

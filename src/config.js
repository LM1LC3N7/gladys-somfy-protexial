// -----------------------------------------------------------------------------
// The configuration of the manifest `config_schema`, normalized.
// -----------------------------------------------------------------------------

import { parseCard } from './card.js';
import { POLL_ARMED, POLL_DISARMED } from './constants.js';
import { MODEL_KEYS } from './models.js';

/** Defaults, mirrored by the manifest (checked by test/manifest.test.js). */
export const DEFAULTS = {
  model: 'auto',
  allow_arm: true,
  allow_disarm: false,
  poll_interval: POLL_ARMED.default,
  poll_interval_disarmed: POLL_DISARMED.default,
  language: 'fr',
};

export const LANGUAGES = ['fr', 'en'];

/**
 * `http://192.168.1.30`, `192.168.1.30:8080/fr/login.htm`… -> `http://192.168.1.30[:8080]`.
 * Only the scheme, host and port matter: every page path comes from the model.
 */
export function normalizeUrl(raw) {
  let text = String(raw ?? '').trim();
  if (text === '') {
    return '';
  }
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    text = `http://${text}`;
  }
  try {
    const url = new URL(text);
    if (!['http:', 'https:'].includes(url.protocol) || url.hostname === '') {
      return '';
    }
    return `${url.protocol}//${url.host}`;
  } catch {
    return '';
  }
}

const bool = (value, fallback) => (typeof value === 'boolean' ? value : fallback);

const seconds = (value, { default: fallback, min, max }) => {
  const number = Number(value);
  return value !== null && value !== '' && value !== undefined && Number.isFinite(number)
    ? Math.round(Math.max(min, Math.min(max, number)))
    : fallback;
};

export function normalizeConfig(raw = {}) {
  const model = String(raw?.model ?? DEFAULTS.model)
    .trim()
    .toLowerCase();
  const language = String(raw?.language ?? DEFAULTS.language)
    .trim()
    .toLowerCase();
  return {
    url: normalizeUrl(raw?.url),
    userCode: String(raw?.user_code ?? '').trim(),
    card: parseCard(raw?.auth_card),
    model: model === 'auto' || MODEL_KEYS.includes(model) ? model : DEFAULTS.model,
    allowArm: bool(raw?.allow_arm, DEFAULTS.allow_arm),
    allowDisarm: bool(raw?.allow_disarm, DEFAULTS.allow_disarm),
    pollArmed: seconds(raw?.poll_interval, POLL_ARMED),
    pollDisarmed: seconds(raw?.poll_interval_disarmed, POLL_DISARMED),
    language: LANGUAGES.includes(language) ? language : DEFAULTS.language,
  };
}

/** What a panel session depends on: a change forgets the detection and the refusals. */
export const sessionKey = (config) =>
  JSON.stringify([config.url, config.userCode, config.card.text, config.model]);

// -----------------------------------------------------------------------------
// Fixed values: manifest keys, Gladys value enums, Somfy error codes, limits
// and timings. The SDK exports the Gladys categories, types and units, not the
// values: the ones used here mirror server/utils/constants.js of the core.
// -----------------------------------------------------------------------------

/** Manifest keys: frozen, users store them in scenes and dashboards. */
export const ACTIONS = {
  TEST_CONNECTION: 'test_connection',
  IMPORT_CARD: 'import_card',
  REFRESH: 'refresh',
  RESET_FAULTS: 'reset_faults',
};

export const SCENE_ACTIONS = {
  RESET_FAULTS: 'reset_faults',
};

export const SCENE_TRIGGERS = {
  ALARM_TRIGGERED: 'alarm_triggered',
  ALARM_ARMED: 'alarm_armed',
  ALARM_DISARMED: 'alarm_disarmed',
  INTRUSION_OR_TAMPER: 'intrusion_or_tamper',
  BATTERY_LOW: 'battery_low',
};

/** The three zones of the panel, in the order of status.xml (zone0..zone2). */
export const ZONES = ['A', 'B', 'C'];

/** Values of the alarm mode select: the zones armed, `off` when none. */
export const MODES = ['off', 'a', 'b', 'c', 'ab', 'ac', 'bc', 'abc'];

/** The fault memories the panel can clear (its "Effacer" buttons). */
export const FAULTS = ['alarm', 'battery', 'link'];

/** Gladys core values (server/utils/constants.js). */
export const COVER_STATE = { STOP: 0, OPEN: 1, CLOSE: -1 };
export const OPENING_SENSOR_STATE = { OPEN: 0, CLOSE: 1 };

/** Error codes the panel shows on its error page (`#infobox b`). */
export const SOMFY_ERRORS = {
  '(0x0B00)': 'wrong_code',
  '(0x1101)': 'wrong_code',
  '(0x1100)': 'wrong_code',
  '(0x0812)': 'wrong_credentials',
  '(0x0901)': 'wrong_credentials',
  '(0x0810)': 'wrong_credentials',
  '(0x0904)': 'max_attempts',
  '(0x0902)': 'busy',
  '(0x0903)': 'not_authorized',
  '(0x0811)': 'access_rights',
  '(0x1003)': 'unknown_parameter',
  '(0x0A03)': 'unknown_parameter',
  '(0x0800)': 'bad_parameter',
  '(0x0000)': 'unexpected',
};

/** Cells of the authentication card: columns A to F, rows 1 to 5. */
export const CARD_COLUMNS = ['A', 'B', 'C', 'D', 'E', 'F'];
export const CARD_ROWS = [1, 2, 3, 4, 5];
export const CARD_CELLS = CARD_ROWS.flatMap((row) => CARD_COLUMNS.map((col) => `${col}${row}`));
export const CHALLENGE_REGEX = /\b[A-F][1-5]\b/;

/** Refresh intervals, in seconds. */
export const POLL_ARMED = { default: 60, min: 30, max: 3600 };
export const POLL_DISARMED = { default: 300, min: 30, max: 86400 };

export const TIMINGS = {
  /** One HTTP request to the panel. */
  requestTimeout: 10_000,
  /** The card import waits this long for the code of the cell asked. */
  importWindow: 5 * 60_000,
  /** The panel sometimes refuses a valid login with 0x0811: one retry after this. */
  accessRightsRetry: 5_000,
  /** Pause between two forms posted in the same session (arm A then B). */
  betweenCommands: 1_000,
  /** A transition seen this long after a Gladys command is credited to it. */
  commandMemory: 5 * 60_000,
  /** Backoff after errors, whatever the interval (the next one is at least the interval). */
  backoff: [60_000, 120_000, 300_000, 600_000, 900_000],
  /** publishChangedStates heartbeat. */
  stateHeartbeat: 30 * 60_000,
};

export const LIMITS = {
  /** Answers of the panel are small pages: refuse anything bigger. */
  maxBodyBytes: 512 * 1024,
  maxRedirects: 5,
  /** Card codes refused in a row before the integration stops logging in. */
  maxRefusals: 2,
  /** Polls in a row finding another session open before taking it over. */
  busyBeforeReset: 5,
};

/** Web interface languages, the French one first (most panels were sold in France). */
export const LANGUAGE_PREFIXES = ['fr', 'de', 'gb', 'en', 'it', 'sp', 'es', 'nl', 'pt'];

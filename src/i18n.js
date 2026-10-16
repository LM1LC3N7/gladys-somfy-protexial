// -----------------------------------------------------------------------------
// Texts: device and feature names (French or English, the `language` setting)
// and the status / action messages (both languages, Gladys shows the user's).
// -----------------------------------------------------------------------------

export const word = (entry, language) => entry?.[language] ?? entry?.en ?? '';

export const DEVICE_NAMES = {
  alarm: { en: 'Somfy alarm', fr: 'Alarme Somfy' },
  shutters: { en: 'Somfy shutters', fr: 'Volets Somfy' },
  lights: { en: 'Somfy lights', fr: 'Lumières Somfy' },
};

export const FEATURE_NAMES = {
  mode: { en: 'Alarm mode', fr: "Mode de l'alarme" },
  'zone-a': { en: 'Zone A armed', fr: 'Zone A armée' },
  'zone-b': { en: 'Zone B armed', fr: 'Zone B armée' },
  'zone-c': { en: 'Zone C armed', fr: 'Zone C armée' },
  triggered: { en: 'Alarm triggered', fr: 'Alarme déclenchée' },
  motion: { en: 'Intrusion detected', fr: 'Intrusion détectée' },
  opening: { en: 'Doors and windows closed', fr: 'Portes et fenêtres fermées' },
  tamper: { en: 'Tamper (box)', fr: 'Autoprotection (boîtier)' },
  'battery-low': { en: 'Low battery (an element)', fr: 'Piles faibles (un élément)' },
  'radio-link': { en: 'Radio link OK', fr: 'Liaison radio OK' },
  'gsm-link': { en: 'GSM connected', fr: 'GSM connecté' },
  'gsm-signal': { en: 'GSM signal (0-5)', fr: 'Signal GSM (0-5)' },
  'gsm-operator': { en: 'GSM operator', fr: 'Opérateur GSM' },
  'camera-link': { en: 'Camera connected', fr: 'Caméra connectée' },
  shutters: { en: 'Shutters', fr: 'Volets' },
  lights: { en: 'Lights', fr: 'Lumières' },
};

export const MODE_NAMES = {
  off: { en: 'Disarmed', fr: 'Désarmée' },
  a: { en: 'Zone A', fr: 'Zone A' },
  b: { en: 'Zone B', fr: 'Zone B' },
  c: { en: 'Zone C', fr: 'Zone C' },
  ab: { en: 'Zones A + B', fr: 'Zones A + B' },
  ac: { en: 'Zones A + C', fr: 'Zones A + C' },
  bc: { en: 'Zones B + C', fr: 'Zones B + C' },
  abc: { en: 'Total (A + B + C)', fr: 'Totale (A + B + C)' },
};

const both = (en, fr) => ({ en, fr });

/** ['A', 'C'] -> "zones A + C armed" / "zones A + C armées". */
function zonesText(zones, language) {
  if (zones.length === 0) {
    return language === 'fr' ? 'aucune zone armée' : 'no zone armed';
  }
  const list = zones.join(' + ');
  if (language === 'fr') {
    return zones.length > 1 ? `zones ${list} armées` : `zone ${list} armée`;
  }
  return `${zones.length > 1 ? 'zones' : 'zone'} ${list} armed`;
}

const panelText = (detected) =>
  detected
    ? `${detected.model.name}${detected.year ? ` ${detected.year}` : ''}${
        detected.version ? ` (${detected.version})` : ''
      }`
    : 'Somfy';

/** Messages: multi-language objects for Gladys, `.en` for the logs. */
export const T = {
  noUrl: both(
    'Enter the address of the panel (e.g. http://192.168.1.30).',
    "Saisissez l'adresse de la centrale (par ex. http://192.168.1.30).",
  ),
  noCode: both('Enter the user access code.', "Saisissez le code d'accès utilisateur."),
  noCard: both(
    'Authentication card missing: import it with "Import the card", or type its 30 codes.',
    "Carte d'authentification absente : importez-la avec « Importer la carte », ou saisissez ses 30 codes.",
  ),
  badCard: (count) =>
    both(
      `The authentication card holds ${count} codes instead of 30: check its format.`,
      `La carte d'authentification contient ${count} codes au lieu de 30 : vérifiez son format.`,
    ),
  connecting: both('Connecting to the panel…', 'Connexion à la centrale…'),
  connected: (detected, zones) =>
    both(
      `${panelText(detected)}: ${zonesText(zones, 'en')}.`,
      `${panelText(detected)} : ${zonesText(zones, 'fr')}.`,
    ),
  unreachable: (reason, wait) =>
    both(
      `Panel unreachable (${reason}), next try in ${wait}.`,
      `Centrale injoignable (${reason}), nouvel essai dans ${wait}.`,
    ),
  notDetected: both(
    'No Somfy Protexial / Protexiom login page at this address: check it, or choose the model.',
    'Pas de page de connexion Somfy Protexial / Protexiom à cette adresse : vérifiez-la, ou choisissez le modèle.',
  ),
  busy: both(
    'Another session is open on the panel (Somfy web page or app?): next try at the next read.',
    'Une autre session est ouverte sur la centrale (page web ou application Somfy ?) : nouvel essai à la prochaine lecture.',
  ),
  cardMissing: (cell) =>
    both(
      `The panel asked for cell ${cell}, missing from the card: complete it.`,
      `La centrale a demandé la case ${cell}, absente de la carte : complétez-la.`,
    ),
  wrongCode: (cells) =>
    both(
      `The panel refused the card code of cell ${cells.join(', ')}: check it.`,
      `La centrale a refusé le code de la case ${cells.join(', ')} de la carte : vérifiez-le.`,
    ),
  stoppedCode: (cells) =>
    both(
      `Stopped after ${cells.length} refused card codes (cells ${cells.join(', ')}), to avoid locking the panel. Fix the card, then save the configuration or click "Test the connection".`,
      `Arrêt après ${cells.length} codes de carte refusés (cases ${cells.join(', ')}), pour ne pas bloquer la centrale. Corrigez la carte, puis enregistrez la configuration ou cliquez sur « Tester la connexion ».`,
    ),
  stoppedUserCode: both(
    'The panel refused the user access code: stopped to avoid locking it. Fix the code, then save the configuration.',
    "La centrale a refusé le code d'accès utilisateur : arrêt pour ne pas la bloquer. Corrigez le code, puis enregistrez la configuration.",
  ),
  stoppedLocked: both(
    'The panel blocks logins after too many attempts: wait a few minutes, check the user code and the card, then click "Test the connection".',
    "La centrale bloque les connexions après trop d'essais : attendez quelques minutes, vérifiez le code d'accès et la carte, puis cliquez sur « Tester la connexion ».",
  ),
  importing: both(
    'Card import in progress: reading paused.',
    'Import de la carte en cours : lecture en pause.',
  ),
  // --- Action answers ---
  importAsk: (cell) =>
    both(
      `The panel asks for cell ${cell} (column ${cell[0]}, row ${cell[1]}) of your card. Type the code of that cell in "Code of the cell asked" and click "Import the card" again within 5 minutes.`,
      `La centrale demande la case ${cell} (colonne ${cell[0]}, ligne ${cell[1]}) de votre carte. Saisissez le code de cette case dans « Code de la case demandée » et cliquez à nouveau sur « Importer la carte » dans les 5 minutes.`,
    ),
  importDone: (count) =>
    both(
      `Card imported: ${count} codes saved in the configuration. Reading resumes.`,
      `Carte importée : ${count} codes enregistrés dans la configuration. La lecture reprend.`,
    ),
  importAdmin: both(
    'This panel shows the card to the administrator only: also type the administrator access code.',
    "Cette centrale ne montre la carte qu'à l'administrateur : saisissez aussi le code d'accès administrateur.",
  ),
  testOk: (detected, zones, card) =>
    both(
      `Connection OK: ${panelText(detected)}, pages /${detected.prefix}/, ${zonesText(zones, 'en')}. Card: ${card.count} codes.`,
      `Connexion réussie : ${panelText(detected)}, pages /${detected.prefix}/, ${zonesText(zones, 'fr')}. Carte : ${card.count} codes.`,
    ),
  testDetected: (detected) =>
    both(
      `Panel found: ${panelText(detected)}, pages /${detected.prefix}/. Import or type the card to read it.`,
      `Centrale trouvée : ${panelText(detected)}, pages /${detected.prefix}/. Importez ou saisissez la carte pour la lire.`,
    ),
  faultsCleared: both('Fault memory cleared.', 'Mémoire des défauts effacée.'),
  // --- Command refusals ---
  disarmRefused: both(
    'Disarming from Gladys is disabled: enable "Allow disarming from Gladys" in the configuration.',
    'Le désarmement depuis Gladys est désactivé : activez « Autoriser le désarmement depuis Gladys » dans la configuration.',
  ),
  armRefused: both(
    'Arming from Gladys is disabled in the configuration.',
    "L'armement depuis Gladys est désactivé dans la configuration.",
  ),
  notReady: both(
    'The panel is not read yet: try again in a moment.',
    "La centrale n'est pas encore lue : réessayez dans un instant.",
  ),
  stopped: both(
    'Logins to the panel are stopped (see the connection status).',
    'Les connexions à la centrale sont arrêtées (voir le statut de connexion).',
  ),
};

/** "45 s", "2 min", "1 h 30". */
export function duration(ms) {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${String(minutes % 60).padStart(2, '0')}`;
}

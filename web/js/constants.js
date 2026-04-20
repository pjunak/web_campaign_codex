// ═══════════════════════════════════════════════════════════════
//  CONSTANTS — cross-module magic values pulled into one place.
//  Anything shared between 3+ modules or used as a foreign-key-
//  like identifier belongs here. Keep this file small and boring.
// ═══════════════════════════════════════════════════════════════

/** Faction id reserved for player party PCs. The /parta list filters
 *  by this value and /postavy excludes it. Combobox sources keep
 *  showing party PCs so relationships/events can still reference them. */
export const PARTY_FACTION_ID = 'party';

/** Route prefix constants. Use these to avoid typoing hashes.
 *  Example:  location.hash = `${ROUTE.POSTAVA}/${id}`  */
export const ROUTE = Object.freeze({
  DASH:        '/',
  PARTA:       '/parta',
  POSTAVY:     '/postavy',
  POSTAVA:     '/postava',
  MISTA:       '/mista',
  MISTO:       '/misto',
  UDALOST:     '/udalost',
  CASOVA:      '/casova-osa',
  ZAHADY:      '/zahady',
  ZAHADA:      '/zahada',
  FRAKCE:      '/frakce',
  DRUHY:       '/druhy',
  DRUH:        '/druh',
  PANTEON:     '/panteon',
  BUH:         '/buh',
  ARTEFAKTY:   '/artefakty',
  ARTEFAKT:    '/artefakt',
  MAPA_SVET:   '/mapa/svet',
  MAPA_PALAC:  '/mapa/palac',
  MAPA_FRAKCE: '/mapa/frakce',
  MAPA_VZTAHY: '/mapa/vztahy',
  MAPA_ZAHADY: '/mapa/tajemstvi',
  ADMIN:       '/admin',
  SETTINGS:    '/nastaveni',
});

/** Centralised Czech pluralisation helper for count-based labels
 *  like "3 postavy" / "1 postava" / "5 postav". Returns the right
 *  form by the small-number / standard-plural rules of Czech. */
export function czPlural(n, one, few, many) {
  const i = Math.abs(n);
  if (i === 1) return one;
  if (i >= 2 && i <= 4) return few;
  return many;
}

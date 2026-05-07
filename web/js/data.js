export const FACTIONS = {};

// STATUS and ARTIFACT_STATES previously lived here but are now owned by
// SETTINGS_DEFAULTS (characterStatuses / artifactStates below). Consumers
// should use Store.getStatusMap() / Store.getArtifactStateMap() which read
// from user-editable settings with a defaults fallback.

export const CHARACTERS        = [];
export const LOCATIONS         = [];
export const EVENTS            = [];
export const RELATIONSHIPS     = [];
export const MYSTERIES         = [];
export const HISTORICAL_EVENTS = [];

// Seeded D&D races. Users can delete any of these; deletion tombstones
// in `deletedDefaults` prevent re-seeding on restart.
export const SPECIES = [
  { id: "human",      name: "Člověk",       description: "" },
  { id: "elf",        name: "Elf",          description: "" },
  { id: "half_elf",   name: "Půlelf",       description: "" },
  { id: "dwarf",      name: "Trpaslík",     description: "" },
  { id: "halfling",   name: "Hobit",        description: "" },
  { id: "gnome",      name: "Gnóm",         description: "" },
  { id: "tiefling",   name: "Tiefling",     description: "" },
  { id: "dragonborn", name: "Dračizeň",     description: "" },
  { id: "half_orc",   name: "Půlork",       description: "" },
  { id: "orc",        name: "Ork",          description: "" },
  { id: "goliath",    name: "Goliáš",       description: "" },
  { id: "half_dragon",name: "Půldrak",      description: "" },
  { id: "aasimar",    name: "Aasimar",      description: "" },
  { id: "genasi",     name: "Genasi",       description: "" },
  { id: "firbolg",    name: "Firbolg",      description: "" },
];

export const PANTHEON  = [];
export const ARTIFACTS = [];

// ── Relationship types ─────────────────────────────────────────
// Single source of truth. Shape:
//   id        — stable key persisted on relationship records
//   label     — Czech-facing text shown in chips, tooltips, legends
//   dirs      — which directionality choices are offered in the editor
//               ('from' = A→B, 'to' = B→A, 'both' = undirected)
//   color     — edge paint in cloudmap (Cytoscape line-color)
//   style     — edge stroke style: solid | dashed | dotted
//   target    — which kind of entity the relationship targets ("character"
//               for now; future-proof for location/faction relationships).
//
// Phase 7 (Settings) will move this into the user-editable `settings`
// collection. Everything that used to read from local copies should
// import from here and pipe through the resolver helpers below.
export const REL_TYPES = [
  { id:'commands',    label:'velí',           dirs:['from','to'],        color:'#C9A14B', style:'solid',  target:'character' },
  { id:'ally',        label:'spojenec/kyně', dirs:['from','to','both'], color:'#2E7D32', style:'solid',  target:'character' },
  { id:'enemy',       label:'nepřítel',       dirs:['from','to','both'], color:'#8B0000', style:'solid',  target:'character' },
  { id:'mission',     label:'mise',           dirs:['from'],             color:'#E65100', style:'dashed', target:'location'  },
  { id:'mystery',     label:'záhada',         dirs:['from','to','both'], color:'#6A1B9A', style:'dotted', target:'character' },
  { id:'captured_by', label:'zajat/a',        dirs:['from','to'],        color:'#0D47A1', style:'solid',  target:'character' },
  { id:'history',     label:'historie',       dirs:['from','to','both'], color:'#795548', style:'dashed', target:'character' },
  { id:'uncertain',   label:'nejasná vazba',  dirs:['from','to','both'], color:'#888',    style:'dotted', target:'character' },
  { id:'negotiates',  label:'vyjednává',      dirs:['from','to','both'], color:'#F9A825', style:'dashed', target:'character' },
];

/** Lookup a relationship type by id. Returns a synthetic orphan entry
 *  (label = id, neutral grey) when the id isn't in REL_TYPES — keeps
 *  rendering alive when a type was deleted in settings. */
export function getRelType(id) {
  return REL_TYPES.find(t => t.id === id)
    || { id, label: id || '?', dirs:['from','to'], color:'#555', style:'dashed', target:'character', _orphan:true };
}

/** Convenience: id → label */
export function relLabel(id) { return getRelType(id).label; }

// ── Settings defaults ──────────────────────────────────────────
// The `settings` collection holds user-editable enums. Seeded from
// this shape on first load; additions/edits/deletions persist to
// `data/settings.json`. Categories coupled to code (knowledge levels
// tied to SVG sketch filters) stay hardcoded and are *not* in here.
export const SETTINGS_DEFAULTS = {
  relationshipTypes: REL_TYPES.map(t => ({ ...t })),

  // Gender options shown in the character editor. Users can extend this
  // list freely; `character.gender` stores the id.
  genders: [
    { id: 'muz',   label: 'Muž' },
    { id: 'zena',  label: 'Žena' },
  ],

  // Place/pin types on the world map and local maps.
  pinTypes: [
    { id:'major_city',  icon:'🏙',  label:'Velké město',  color:'#D4A017', priority:1 },
    { id:'city',        icon:'🏛',  label:'Město',         color:'#C0A060', priority:2 },
    { id:'town',        icon:'🏘',  label:'Městečko',      color:'#A0B080', priority:3 },
    { id:'village',     icon:'🏠',  label:'Vesnice',       color:'#80A070', priority:3 },
    { id:'fortress',    icon:'🏰',  label:'Pevnost',       color:'#9090A0', priority:1 },
    { id:'castle',      icon:'🏯',  label:'Hrad',          color:'#9A9AA8', priority:1 },
    { id:'tower',       icon:'🗼',  label:'Věž',           color:'#A8A098', priority:3 },
    { id:'temple',      icon:'🛕',  label:'Chrám',         color:'#C0A088', priority:3 },
    { id:'shrine',      icon:'⛩',  label:'Svatyně',       color:'#80A0B0', priority:3 },
    { id:'tavern',      icon:'🍺',  label:'Hospoda',       color:'#C89050', priority:3 },
    { id:'market',      icon:'🏪',  label:'Trh',           color:'#C8A050', priority:3 },
    { id:'academy',     icon:'🎓',  label:'Akademie',      color:'#A890C0', priority:2 },
    { id:'port',        icon:'⚓',  label:'Přístav',       color:'#6090A0', priority:2 },
    { id:'bridge',      icon:'🌉',  label:'Most',          color:'#909090', priority:3 },
    { id:'camp',        icon:'⛺',  label:'Tábor',         color:'#B88040', priority:3 },
    { id:'dungeon',     icon:'⚠',   label:'Dungeon',       color:'#A06040', priority:3 },
    { id:'cave',        icon:'🕳',  label:'Jeskyně',       color:'#706050', priority:3 },
    { id:'ruin',        icon:'🏚',  label:'Ruina',         color:'#888070', priority:3 },
    { id:'graveyard',   icon:'🪦',  label:'Hřbitov',       color:'#808080', priority:3 },
    { id:'battlefield', icon:'⚔',   label:'Bojiště',       color:'#A04040', priority:3 },
    { id:'landmark',    icon:'🗿',  label:'Bod zájmu',     color:'#80A0B0', priority:3 },
    { id:'forest',      icon:'🌲',  label:'Les',           color:'#4A7A4A', priority:3 },
    { id:'mountain',    icon:'⛰',   label:'Hora',          color:'#8A7A6A', priority:3 },
    { id:'lake',        icon:'🏞',  label:'Jezero',        color:'#5A90B0', priority:3 },
    { id:'curiosity',   icon:'✨',  label:'Zajímavost',    color:'#C8A040', priority:3 },
    { id:'region',      icon:'🗺',  label:'Oblast',        color:'#708090', priority:2 },
    { id:'enemy',       icon:'💀',  label:'Nepřátelské',   color:'#B04040', priority:3 },
    { id:'custom',      icon:'📌',  label:'Vlastní',       color:'#8A5CC8', priority:3 },
  ],

  // Character status — narrower than old `captured` enum; legacy migration
  // in store.js turns `captured` into alive + `circumstances`.
  characterStatuses: [
    { id: 'alive',   label: 'Naživu',   color: '#2E7D32', icon: '●' },
    { id: 'dead',    label: 'Mrtvý/á', color: '#8B0000', icon: '✦' },
    { id: 'unknown', label: 'Neznámo', color: '#6A1B9A', icon: '?' },
  ],

  artifactStates: [
    { id: 'nalezen',   label: 'Nalezen',   color: '#2E7D32', icon: '✨' },
    { id: 'u_postavy', label: 'U postavy', color: '#C9A14B', icon: '🎒' },
    { id: 'strezeny',  label: 'Střežený',  color: '#1565C0', icon: '🛡' },
    { id: 'skryty',    label: 'Skrytý',    color: '#6A1B9A', icon: '🕵' },
    { id: 'ztraceny',  label: 'Ztracený',  color: '#795548', icon: '❓' },
    { id: 'zniceny',   label: 'Zničený',   color: '#8B0000', icon: '💥' },
  ],

  eventPriorities: [
    { id: 'kritická', label: 'Kritická', color: '#8B0000' },
    { id: 'vysoká',   label: 'Vysoká',   color: '#E65100' },
    { id: 'střední',  label: 'Střední',  color: '#FFA000' },
    { id: 'nízká',    label: 'Nízká',    color: '#689F38' },
  ],

  // Unified "Postoje k partě" palette — shared by characters,
  // locations and factions. Each entity carries an `attitudes` array
  // of `{id, strength: 0..1}` objects; renderers stack a colored
  // `drop-shadow` per entry on the entity's icon (portrait, pin
  // emoji, faction badge), so multiple stances mix into one halo and
  // strength controls glow intensity. Empty array = "unknown" (no
  // glow). The `party` id is reserved for our strongholds — characters
  // with `faction==='party'` render with this palette automatically.
  // `bg` = solid pin fill, `fg` = icon contrast on the pin,
  // `labelColor` = readable chip/glow color on dark UI.
  attitudes: [
    { id: 'ally',    label: 'Spojenec',   bg: '#2E7D32', fg: '#ffffff', labelColor: '#4CAF50' },
    { id: 'enemy',   label: 'Nepřítel',   bg: '#C62828', fg: '#ffffff', labelColor: '#EF5350' },
    { id: 'hostile', label: 'Nebezpečný', bg: '#7E1F1F', fg: '#ffffff', labelColor: '#FF7043' },
    { id: 'neutral', label: 'Neutrální',  bg: '#1565C0', fg: '#ffffff', labelColor: '#64B5F6' },
    { id: 'party',   label: 'Parta',      bg: '#F5F0E4', fg: '#1a1410', labelColor: '#F0E6C8' },
  ],

  // Physical state of a place — separate from `attitudes` (which is
  // about the party's stance). Free-text dropdowns were promoted to
  // this managed enum so the GM can recolor / reicon them in Settings,
  // and `_migrateLocationStatusToManaged` in store.js auto-imports any
  // pre-existing free-text values on first load.
  locationStatuses: [
    { id: 'aktivni',      label: 'Aktivní',      icon: '●',  color: '#4CAF50' },
    { id: 'opustene',     label: 'Opuštěné',     icon: '🌫', color: '#9E9E9E' },
    { id: 'polorozpadle', label: 'Polorozpadlé', icon: '🏚', color: '#FFA000' },
    { id: 'v_plamenech',  label: 'V plamenech',  icon: '🔥', color: '#E64A19' },
    { id: 'zniceno',      label: 'Zničeno',      icon: '⚰',  color: '#424242' },
    { id: 'tajne',        label: 'Tajné',        icon: '🤫', color: '#6A1B9A' },
  ],

  // User-defined map view presets. Each entry captures the bounds
  // of a Leaflet view as fractions (0-1) of the image so the preset
  // stays valid across resizes. Shape:
  //   { id, label, icon, parentId, bounds: {x1,y1,x2,y2} }
  // parentId=null → world map; location id → that location's local map.
  // Captured from the live map via the ✚ toolbar button (edit mode).
  mapViews: [],
};

/** Which collection+field each settings category is referenced from.
 *  `Store.findEnumUsages(cat, id)` walks these bindings. Defined here
 *  so the mapping is co-located with the defaults.
 *
 *  `attitudes` is bound on three collections — characters, locations
 *  and factions — and stored as an array of `{id, strength}` objects
 *  in every case. `findEnumUsages` / `deleteEnumItem` recognise that
 *  shape and look up by entry.id. `factions` is a keyed-object
 *  collection (Object.values), the others are arrays.                  */
export const SETTINGS_USAGE_MAP = {
  relationshipTypes: [{ collection: 'relationships', field: 'type' }],
  genders:           [{ collection: 'characters',    field: 'gender' }],
  pinTypes:          [{ collection: 'locations',     field: 'pinType' }],
  artifactStates:    [{ collection: 'artifacts',     field: 'state' }],
  characterStatuses: [{ collection: 'characters',    field: 'status' }],
  locationStatuses:  [{ collection: 'locations',     field: 'status' }],
  eventPriorities:   [{ collection: 'events',        field: 'priority' }],
  attitudes:         [
    { collection: 'characters', field: 'attitudes' },
    { collection: 'locations',  field: 'attitudes' },
    { collection: 'factions',   field: 'attitudes' },
  ],
};

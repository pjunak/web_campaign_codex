import { FACTIONS, STATUS, CHARACTERS, LOCATIONS, EVENTS, RELATIONSHIPS, MYSTERIES, MAP_PINS } from './data.js';
import { norm } from './utils.js';

export const Store = (() => {
  let _data            = null;
  let _serverAvailable = false;

  // ── Secondary indices (rebuilt by _reindex on every mutation) ──
  let _idxCharsByFaction   = new Map();
  let _idxCharsByLocation  = new Map();
  let _idxRelsByChar       = new Map();
  let _idxEventsByChar     = new Map();
  let _idxEventsByLocation = new Map();
  let _idxMysteriesByChar  = new Map();
  let _idxPinsByLocation   = new Map();

  function _push(map, key, val) {
    if (!key) return;
    let arr = map.get(key);
    if (!arr) { arr = []; map.set(key, arr); }
    arr.push(val);
  }

  function _reindex() {
    _idxCharsByFaction   = new Map();
    _idxCharsByLocation  = new Map();
    _idxRelsByChar       = new Map();
    _idxEventsByChar     = new Map();
    _idxEventsByLocation = new Map();
    _idxMysteriesByChar  = new Map();
    _idxPinsByLocation   = new Map();
    if (!_data) return;

    for (const c of _data.characters || []) {
      _push(_idxCharsByFaction, c.faction, c);
      if (c.location) _push(_idxCharsByLocation, c.location, c);
      for (const r of c.locationRoles || []) {
        if (r?.locationId) _push(_idxCharsByLocation, r.locationId, c);
      }
    }
    for (const r of _data.relationships || []) {
      _push(_idxRelsByChar, r.source, r);
      if (r.target !== r.source) _push(_idxRelsByChar, r.target, r);
    }
    for (const e of _data.events || []) {
      for (const cid of e.characters || []) _push(_idxEventsByChar, cid, e);
      for (const lid of e.locations  || []) _push(_idxEventsByLocation, lid, e);
    }
    for (const m of _data.mysteries || []) {
      for (const cid of m.characters || []) _push(_idxMysteriesByChar, cid, m);
    }
    for (const p of _data.mapPins || []) {
      if (p.locationId) _push(_idxPinsByLocation, p.locationId, p);
    }
  }

  function _defaults() {
    return {
      characters:    JSON.parse(JSON.stringify(CHARACTERS)),
      relationships: JSON.parse(JSON.stringify(RELATIONSHIPS)),
      locations:     JSON.parse(JSON.stringify(LOCATIONS)),
      events:        JSON.parse(JSON.stringify(EVENTS)),
      mysteries:     JSON.parse(JSON.stringify(MYSTERIES)),
      mapPins:       JSON.parse(JSON.stringify(MAP_PINS)),
      factions:      JSON.parse(JSON.stringify(FACTIONS)),
    };
  }

  function _mergeDefaults() {
    const deleted  = new Set(_data.deletedDefaults || []);
    const savedIds = new Set(_data.characters.map(c => c.id));
    for (const c of CHARACTERS) {
      if (!savedIds.has(c.id) && !deleted.has(c.id)) {
        _data.characters.push(JSON.parse(JSON.stringify(c)));
      }
    }
    if (!_data.factions) {
      _data.factions = JSON.parse(JSON.stringify(FACTIONS));
    } else {
      for (const [id, fac] of Object.entries(FACTIONS)) {
        if (!_data.factions[id]) _data.factions[id] = JSON.parse(JSON.stringify(fac));
      }
    }
  }

  async function load() {
    try {
      const res = await fetch('/api/data');
      if (res.ok) {
        _serverAvailable = true;
        const serverData = await res.json();
        if (serverData && serverData.characters) {
          _data = serverData;
          _mergeDefaults();
          _reindex();
          return;
        }
        _data = _defaults();
        _reindex();
        _persist();
        return;
      }
    } catch (e) {
      console.error('Store: server not reachable.', e);
    }
    _serverAvailable = false;
    _data = _defaults();
    _reindex();
    window.dispatchEvent(new CustomEvent('store:server-unavailable'));
  }

  function init() {
    if (!_data) { _data = _defaults(); _reindex(); }
  }

  function _persist() {
    if (!_data || !_serverAvailable) return false;
    fetch('/api/data', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(_data),
    }).catch(e => {
      console.warn('Store: server save failed.', e);
      window.dispatchEvent(new CustomEvent('store:save-failed'));
    });
    return true;
  }

  function _sync(type, action, payload) {
    if (!_serverAvailable) return false;
    fetch('/api/data', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ type, action, payload }),
    }).then(res => {
      if (res.status === 401) window.dispatchEvent(new CustomEvent('store:auth-failed'));
    }).catch(e => {
      console.warn('Store: server sync failed.', e);
      window.dispatchEvent(new CustomEvent('store:save-failed'));
    });
    return true;
  }

  async function uploadPortrait(file, charId) {
    if (!charId) throw new Error('uploadPortrait: charId is required.');
    if (!_serverAvailable) throw new Error('Server není dostupný — nelze nahrát obrázek.');
    const form     = new FormData();
    form.append('portrait', file);
    const endpoint = `/api/portrait/${encodeURIComponent(charId)}`;
    const res = await fetch(endpoint, { method: 'POST', body: form });
    if (res.ok) return (await res.json()).url;
    if (res.status === 401) {
      window.dispatchEvent(new CustomEvent('store:auth-failed'));
      throw new Error('Neznámé nebo chybějící heslo.');
    }
    throw new Error('Nahrání portrétu selhalo.');
  }

  function deletePortrait(url) {
    if (!_serverAvailable || !url || !url.startsWith('/portraits/')) return;
    const identifier = url.slice('/portraits/'.length).split('/')[0];
    if (!identifier) return;
    fetch(`/api/portrait/${encodeURIComponent(identifier)}`, { method: 'DELETE' })
      .then(res => { if (res.status === 401) window.dispatchEvent(new CustomEvent('store:auth-failed')); })
      .catch(e => console.warn('Store: portrait delete failed.', e));
  }

  function getCharacters()    { init(); return _data.characters; }
  function getRelationships() { init(); return _data.relationships; }
  function getLocations()     { init(); return _data.locations; }
  function getEvents()        { init(); return _data.events; }
  function getMysteries()     { init(); return _data.mysteries; }
  function getMapPins()       { init(); return _data.mapPins || (_data.mapPins = JSON.parse(JSON.stringify(MAP_PINS))); }
  function getFactions()      { init(); return _data.factions; }
  function getFaction(id)     { return getFactions()[id] || null; }
  function getStatusMap()     { return STATUS; }

  function getCharacter(id) { return getCharacters().find(c => c.id === id) || null; }
  function getLocation(id)  { return getLocations().find(l => l.id === id) || null; }
  function getEvent(id)     { return getEvents().find(e => e.id === id) || null; }
  function getMystery(id)   { return getMysteries().find(m => m.id === id) || null; }

  function saveCharacter(char) {
    init();
    const idx = _data.characters.findIndex(c => c.id === char.id);
    if (idx >= 0) _data.characters[idx] = char; else _data.characters.push(char);
    _reindex();
    return _sync('characters', 'save', char);
  }

  function deleteCharacter(id) {
    init();
    const char = _data.characters.find(c => c.id === id);
    if (char?.portrait) deletePortrait(char.portrait);
    if (CHARACTERS.some(c => c.id === id)) {
      if (!_data.deletedDefaults) _data.deletedDefaults = [];
      if (!_data.deletedDefaults.includes(id)) _data.deletedDefaults.push(id);
    }
    _data.characters    = _data.characters.filter(c => c.id !== id);
    _data.relationships = _data.relationships.filter(r => r.source !== id && r.target !== id);
    _data.events        = (_data.events    || []).map(e => ({ ...e, characters: (e.characters    || []).filter(cid => cid !== id) }));
    _data.mysteries     = (_data.mysteries || []).map(m => ({ ...m, characters: (m.characters    || []).filter(cid => cid !== id) }));
    _reindex();
    return _sync('characters', 'delete', { id });
  }

  function saveRelationship(rel) {
    init();
    const key = r => `${r.source}||${r.target}||${r.type}`;
    const k   = key(rel);
    const idx = _data.relationships.findIndex(r => key(r) === k);
    if (idx >= 0) _data.relationships[idx] = rel; else _data.relationships.push(rel);
    _reindex();
    return _sync('relationships', 'save', rel);
  }

  function deleteRelationship(source, target, type) {
    init();
    _data.relationships = _data.relationships.filter(
      r => !(r.source === source && r.target === target && r.type === type)
    );
    _reindex();
    return _sync('relationships', 'delete', { source, target, type });
  }

  function saveLocation(loc) {
    init();
    const idx = _data.locations.findIndex(l => l.id === loc.id);
    if (idx >= 0) _data.locations[idx] = loc; else _data.locations.push(loc);
    _reindex();
    return _sync('locations', 'save', loc);
  }

  function deleteLocation(id) {
    init();
    _data.locations = _data.locations.filter(l => l.id !== id);
    _reindex();
    return _sync('locations', 'delete', { id });
  }

  function saveEvent(evt) {
    init();
    const idx = _data.events.findIndex(e => e.id === evt.id);
    if (idx >= 0) _data.events[idx] = evt; else _data.events.push(evt);
    _reindex();
    return _sync('events', 'save', evt);
  }

  function deleteEvent(id) {
    init();
    _data.events = _data.events.filter(e => e.id !== id);
    _reindex();
    return _sync('events', 'delete', { id });
  }

  function saveMystery(mys) {
    init();
    const idx = _data.mysteries.findIndex(m => m.id === mys.id);
    if (idx >= 0) _data.mysteries[idx] = mys; else _data.mysteries.push(mys);
    _reindex();
    return _sync('mysteries', 'save', mys);
  }

  function deleteMystery(id) {
    init();
    _data.mysteries = _data.mysteries.filter(m => m.id !== id);
    _reindex();
    return _sync('mysteries', 'delete', { id });
  }

  function saveFaction(id, fac) {
    init();
    _data.factions[id] = fac;
    return _sync('factions', 'save', { id, data: fac });
  }

  function deleteFaction(id) {
    init();
    delete _data.factions[id];
    return _sync('factions', 'delete', { id });
  }

  function saveMapPin(pin) {
    init();
    const pins = getMapPins();
    const idx  = pins.findIndex(p => p.id === pin.id);
    if (idx >= 0) pins[idx] = pin; else pins.push(pin);
    _reindex();
    return _sync('mapPins', 'save', pin);
  }

  function deleteMapPin(id) {
    init();
    _data.mapPins = getMapPins().filter(p => p.id !== id);
    _reindex();
    return _sync('mapPins', 'delete', { id });
  }

  // ── Indexed lookups ─────────────────────────────────────────
  function getCharactersByFaction(factionId) {
    init(); return _idxCharsByFaction.get(factionId) || [];
  }
  function getCharactersInLocation(locId) {
    init(); return _idxCharsByLocation.get(locId) || [];
  }
  function getRelationshipsFor(charId) {
    init(); return _idxRelsByChar.get(charId) || [];
  }
  function getEventsWithCharacter(charId) {
    init(); return _idxEventsByChar.get(charId) || [];
  }
  function getEventsAtLocation(locId) {
    init(); return _idxEventsByLocation.get(locId) || [];
  }
  function getMysteriesWithCharacter(charId) {
    init(); return _idxMysteriesByChar.get(charId) || [];
  }
  function getPinForLocation(locId) {
    init(); const arr = _idxPinsByLocation.get(locId); return arr ? arr[0] : null;
  }

  // ── Search ─────────────────────────────────────────────────
  // Diacritic-insensitive substring match over user-visible text fields.
  function _match(haystack, q) {
    if (!q) return true;
    return norm(haystack).includes(q);
  }
  function searchCharacters(query) {
    init();
    const q = norm(query);
    if (!q) return _data.characters.slice();
    return _data.characters.filter(c =>
      _match(c.name, q) || _match(c.title, q) || _match((c.tags || []).join(' '), q)
    );
  }
  function searchLocations(query) {
    init();
    const q = norm(query);
    if (!q) return _data.locations.slice();
    return _data.locations.filter(l =>
      _match(l.name, q) || _match(l.type, q) || _match((l.tags || []).join(' '), q)
    );
  }
  function searchEvents(query) {
    init();
    const q = norm(query);
    if (!q) return _data.events.slice();
    return _data.events.filter(e =>
      _match(e.name, q) || _match(e.short, q) || _match((e.tags || []).join(' '), q)
    );
  }
  function searchMysteries(query) {
    init();
    const q = norm(query);
    if (!q) return _data.mysteries.slice();
    return _data.mysteries.filter(m =>
      _match(m.name, q) || _match((m.questions || []).join(' '), q) || _match((m.tags || []).join(' '), q)
    );
  }
  function searchAll(query) {
    return {
      characters: searchCharacters(query),
      locations:  searchLocations(query),
      events:     searchEvents(query),
      mysteries:  searchMysteries(query),
    };
  }

  function generateId(name) {
    return name.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .substring(0, 40);
  }

  function reset() {
    _data = _defaults();
    _reindex();
    _persist();
  }

  function exportJS() {
    init();
    const ts = new Date().toLocaleString('cs-CZ');
    return [
      `// O Barvách Draků — Export dat (${ts})`,
      `// Vlož jako obsah js/data.js`,
      ``,
      `const FACTIONS = ${JSON.stringify(_data.factions, null, 2)};`,
      ``,
      `const CHARACTERS = ${JSON.stringify(_data.characters, null, 2)};`,
      ``,
      `const RELATIONSHIPS = ${JSON.stringify(_data.relationships, null, 2)};`,
      ``,
      `const LOCATIONS = ${JSON.stringify(_data.locations, null, 2)};`,
      ``,
      `const EVENTS = ${JSON.stringify(_data.events, null, 2)};`,
      ``,
      `const MYSTERIES = ${JSON.stringify(_data.mysteries, null, 2)};`,
    ].join('\n');
  }

  function importJSON(json) {
    try {
      const parsed = JSON.parse(json);
      if (parsed.characters) _data = { ..._defaults(), ...parsed };
      else throw new Error('Neplatný formát');
      _reindex();
      _persist();
      return true;
    } catch(e) {
      return false;
    }
  }

  function exportJSON() {
    init();
    const ts = new Date().toLocaleString('cs-CZ');
    return JSON.stringify({
      _version:      3,
      _exported:     ts,
      factions:      _data.factions,
      characters:    _data.characters,
      relationships: _data.relationships,
      locations:     _data.locations,
      events:        _data.events,
      mysteries:     _data.mysteries,
      mapPins:       getMapPins(),
    }, null, 2);
  }

  return {
    load, init,
    uploadPortrait, deletePortrait,
    getCharacters, getRelationships, getLocations, getEvents, getMysteries,
    getMapPins, getFactions, getFaction, getStatusMap,
    getCharacter, getLocation, getEvent, getMystery,
    getCharactersByFaction, getCharactersInLocation, getRelationshipsFor,
    getEventsWithCharacter, getEventsAtLocation, getMysteriesWithCharacter,
    getPinForLocation,
    searchCharacters, searchLocations, searchEvents, searchMysteries, searchAll,
    saveCharacter, deleteCharacter,
    saveRelationship, deleteRelationship,
    saveLocation, deleteLocation,
    saveEvent, deleteEvent,
    saveMystery, deleteMystery,
    saveMapPin, deleteMapPin,
    saveFaction, deleteFaction,
    generateId, reset, exportJS, exportJSON, importJSON,
  };
})();

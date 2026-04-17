// ═══════════════════════════════════════════════════════════════
//  CLOUD MAP — Information-cloud mind map, replaces circular nodes.
//  Each graph node becomes an HTML "cloud" card with rich context.
//  Cytoscape handles layout/physics via invisible proxy nodes.
//  The HTML cloud layer is overlaid and synced to the viewport.
// ═══════════════════════════════════════════════════════════════

import { Store } from './store.js';
import { norm, debounce } from './utils.js';

export const CloudMap = (() => {

  // ── Layout constants ────────────────────────────────────────
  const CW         = 168;          // cloud width  (graph px = screen px at zoom 1)
  const PAD        = 10;           // inner horizontal padding
  const IW         = CW - PAD * 2; // inner text width for wrapping

  const FONT_STRIP = '500 10px Inter, sans-serif';
  const FONT_NAME  = '600 13px Cinzel, Georgia, serif';
  const FONT_FACT  = '11px Lora, Georgia, serif';

  // Heights derived from actual CSS box model:
  //   .cm-cloud  → border-top:2 + padding-top:0 + padding-bottom:8 + border-bottom:1
  //   .cm-strip  → padding(5+3) + ~11px text  = 19px
  //   .cm-name   → 13px × 1.25 lh + 4px margin = 20px
  //   .cm-divider → 1px + 5px margin = 6px
  //   .cm-fact   → 11px × 1.4 lh + 2px margin = ~18px
  const H_OVERHEAD = 11;  // border(2+1) + padding-bottom(8)
  const H_STRIP    = 19;
  const H_NAME     = 20;
  const H_DIVIDER  = 6;
  const H_FACT     = 18;

  // ── Canvas TextMeasure (Pretext-style) ──────────────────────
  const _cvs = document.createElement('canvas');
  const _ctx = _cvs.getContext('2d');
  const _cache = new Map();

  function _wordW(word, font) {
    const key = font + '|' + word;
    if (_cache.has(key)) return _cache.get(key);
    _ctx.font = font;
    const w = _ctx.measureText(word).width;
    _cache.set(key, w);
    return w;
  }

  // Returns array of wrapped line strings.
  function _wrap(text, font, maxW) {
    const words = String(text || '').split(' ').filter(Boolean);
    if (!words.length) return [''];
    const lines = [];
    let line = '';
    for (const word of words) {
      const test = line ? line + ' ' + word : word;
      if (_wordW(test, font) <= maxW) {
        line = test;
      } else {
        if (line) lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  // ── Cloud height estimation ─────────────────────────────────
  // Pre-layout estimate: counts fact rows × H_FACT, then adds fixed overhead.
  // _resizeToActual() corrects any residual error after first DOM render.
  function _base() { return H_STRIP + H_NAME + H_DIVIDER; }

  function _charCloudH(c, mode) {
    let rows = 0;
    if (mode === 'frakce') {
      if (c.knowledge >= 2 && c.title) rows += _wrap(c.title, FONT_FACT, IW).length;
      const rels = Store.getRelationships();
      if (rels.some(r => r.source === c.id && r.type === 'commands')) rows++;
      if (rels.some(r => r.target === c.id && r.type === 'commands')) rows++;
      if (!rows) rows = 1; // "Bez vazeb velení" fallback
    } else if (mode === 'vztahy') {
      rows = 2; // status + count
      if (Store.getRelationships().some(r => r.source === c.id || r.target === c.id)) rows++;
    } else if (mode === 'tajemstvi') {
      rows = 1;
      const mysteries = Store.getMysteries().filter(m => (m.characters || []).includes(c.id));
      if (mysteries.length) {
        const q = (mysteries[0].questions || [])[0] || mysteries[0].name;
        rows += Math.min(2, _wrap(q, FONT_FACT, IW).length);
      }
    } else if (mode === 'casova-osa') {
      rows = 1;
      if (Store.getEvents().some(e => (e.characters || []).includes(c.id))) rows++;
    }
    return _base() + rows * H_FACT + H_OVERHEAD;
  }

  function _mysteryCloudH(m) {
    const q     = (m.questions || [])[0];
    const qRows = q ? Math.min(2, _wrap(q, FONT_FACT, IW).length) : 0;
    return _base() + (1 + qRows) * H_FACT + H_OVERHEAD;
  }

  function _eventCloudH(e) {
    const rows = Math.min(2, _wrap(e.short || e.name, FONT_FACT, IW).length);
    return _base() + rows * H_FACT + H_OVERHEAD;
  }

  // ── Faction hub / location cloud sizes ───────────────────────
  const CW_HUB      = 210;
  const PAD_HUB     = 20;                // wider padding for pill shape
  const IW_HUB      = CW_HUB - PAD_HUB * 2;
  const H_OVERHEAD_HUB = 14;             // border(3+1) + padding-bottom(10)

  function _factionHubCloudH(faction, count) {
    // strip + name + divider + 1 fact row (member count) + pill overhead
    let rows = 1;
    if (faction.description) rows += Math.min(2, _wrap(faction.description, FONT_FACT, IW_HUB).length);
    return _base() + rows * H_FACT + H_OVERHEAD_HUB;
  }

  function _factionHubCloudHTML(fId, faction, count) {
    let body = `<div class="cm-fact">${count} ${count === 1 ? 'postava' : count < 5 ? 'postavy' : 'postav'}</div>`;
    return `<div class="cm-cloud cm-faction-hub" data-id="hub_${fId}" data-type="faction"
              style="--cc:${faction.color}; width:${CW_HUB}px">
      <div class="cm-strip">${_esc(faction.badge)} FRAKCE</div>
      <div class="cm-name">${_esc(faction.name)}</div>
      <div class="cm-divider"></div>
      ${body}
    </div>`;
  }

  function _locationCloudH(loc, mode) {
    // strip + name + divider + optional status row + overhead
    let rows = loc.status ? 1 : 0;
    if (mode === 'mista') {
      // region row + chip rows (~2 chars per row, max 3 rows)
      if (loc.region) rows++;
      const charCount = (loc.characters || []).length;
      if (charCount) rows += Math.min(3, Math.ceil(charCount / 2));
      const conCount = (loc.connections || []).length;
      if (conCount) rows++;
    }
    return _base() + rows * H_FACT + H_OVERHEAD;
  }

  function _locationCloudHTML(loc, mode) {
    const status = loc.status || '';
    let body = '';

    if (mode === 'mista') {
      if (loc.region) body += `<div class="cm-fact cm-hint">${_esc(loc.region)}</div>`;
      if (status)     body += `<div class="cm-fact cm-dim">${_esc(status)}</div>`;
      const chars = (loc.characters || [])
        .map(cid => Store.getCharacter(cid)).filter(Boolean);
      if (chars.length) {
        const chips = chars.slice(0, 6).map(c => {
          const f = Store.getFactions()[c.faction] || {};
          return `<span class="cm-loc-chip" style="--cc:${f.color || '#888'}">${_esc(c.name)}</span>`;
        }).join('');
        const more = chars.length > 6 ? `<span class="cm-loc-chip cm-loc-chip-more">+${chars.length - 6}</span>` : '';
        body += `<div class="cm-loc-chips">${chips}${more}</div>`;
      }
      const conCount = (loc.connections || []).length;
      if (conCount) {
        body += `<div class="cm-fact cm-dim">${conCount} ${conCount === 1 ? 'spojení' : conCount < 5 ? 'spojení' : 'spojení'}</div>`;
      }
    } else {
      if (status) body += `<div class="cm-fact cm-dim">${_esc(status)}</div>`;
    }

    return `<div class="cm-cloud cm-location" data-id="${loc.id}" data-type="location"
              style="--cc:#5D7A3A; width:${CW}px">
      <div class="cm-strip">📍 Místo</div>
      <div class="cm-name">${_esc(loc.name)}</div>
      <div class="cm-divider"></div>
      ${body}
    </div>`;
  }

  /** Scan characters → Map<factionId, Set<locationId>> */
  function _deriveFactionLocations(chars) {
    const map = new Map();
    for (const c of chars) {
      if (!c.faction) continue;
      if (!map.has(c.faction)) map.set(c.faction, new Set());
      const s = map.get(c.faction);
      if (c.location) s.add(c.location);
      if (c.locationRoles) c.locationRoles.forEach(lr => { if (lr.locationId) s.add(lr.locationId); });
    }
    return map;
  }

  // ── Data helpers ────────────────────────────────────────────
  function _factionColor(id) { return Store.getFactions()[id]?.color  || '#444'; }
  function _factionBadge(id) { return Store.getFactions()[id]?.badge  || '';    }
  function _factionName(id)  { return Store.getFactions()[id]?.name   || id;    }
  function _statusIcon(s)    { return Store.getStatusMap()[s]?.icon   || '?';   }
  function _statusLabel(s)   { return Store.getStatusMap()[s]?.label  || s;     }
  function _statusColor(s)   { return Store.getStatusMap()[s]?.color  || '#888';}

  // ── Cloud HTML builders ─────────────────────────────────────

  function _charCloudHTML(c, mode) {
    const isDead  = c.status === 'dead';
    const fColor  = isDead ? '#666' : _factionColor(c.faction);
    const badge   = _factionBadge(c.faction);
    const faction = _factionName(c.faction);
    const name    = c.knowledge >= 1 ? c.name : '???';
    const deadMark = isDead ? '💀 ' : '';

    let body = '';

    if (mode === 'frakce') {
      if (c.knowledge >= 2 && c.title) {
        body += `<div class="cm-fact">${_esc(c.title)}</div>`;
      }
      const rels = Store.getRelationships();
      const cmdOut = rels.filter(r => r.source === c.id && r.type === 'commands');
      const cmdIn  = rels.filter(r => r.target === c.id && r.type === 'commands');
      if (cmdOut.length) {
        body += `<div class="cm-fact cm-dim">Velí ${cmdOut.length} ${cmdOut.length === 1 ? 'osobě' : cmdOut.length < 5 ? 'osobám' : 'osobám'}</div>`;
      }
      if (cmdIn.length) {
        const boss = Store.getCharacter(cmdIn[0].source);
        if (boss) body += `<div class="cm-fact cm-dim">Pod velením: ${_esc(boss.name)}</div>`;
      }
      if (!body) body = `<div class="cm-fact cm-dim">Bez vazeb velení</div>`;

    } else if (mode === 'vztahy') {
      const sIcon  = _statusIcon(c.status);
      const sLabel = _statusLabel(c.status);
      const sColor = _statusColor(c.status);
      body += `<div class="cm-status-row"><span style="color:${sColor}">${sIcon}</span> ${_esc(sLabel)}</div>`;
      const rels = Store.getRelationships().filter(r => r.source === c.id || r.target === c.id);
      body += `<div class="cm-fact cm-dim">${rels.length} ${rels.length === 1 ? 'vazba' : rels.length < 5 ? 'vazby' : 'vazeb'}</div>`;
      if (rels.length) {
        const counts = {};
        rels.forEach(r => { counts[r.type] = (counts[r.type] || 0) + 1; });
        const TYPE_LABELS = {
          commands:'velení', ally:'spojenec', enemy:'nepřítel',
          mission:'mise', mystery:'záhada', history:'minulost',
          uncertain:'nejistota', negotiates:'jednání', captured_by:'zajatec',
        };
        const top = Object.entries(counts).sort((a,b) => b[1]-a[1]).slice(0, 2)
          .map(([t,n]) => `${TYPE_LABELS[t] || t}×${n}`).join(', ');
        body += `<div class="cm-fact cm-dim">${top}</div>`;
      }

    } else if (mode === 'tajemstvi') {
      const mysteries = Store.getMysteries().filter(m => (m.characters || []).includes(c.id));
      const cnt = mysteries.length;
      body += `<div class="cm-fact cm-dim">${cnt} ${cnt === 1 ? 'záhada' : cnt < 5 ? 'záhady' : 'záhad'}</div>`;
      if (mysteries.length) {
        const q = (mysteries[0].questions || [])[0] || mysteries[0].name;
        const lines = _wrap(q, FONT_FACT, IW).slice(0, 2);
        const snippet = lines.join(' ') + (lines.length < _wrap(q, FONT_FACT, IW).length ? '…' : '');
        body += `<div class="cm-fact cm-hint">${_esc(snippet)}</div>`;
      }

    } else if (mode === 'casova-osa') {
      const events = Store.getEvents()
        .filter(e => (e.characters || []).includes(c.id))
        .sort((a,b) => a.order - b.order);
      const cnt = events.length;
      body += `<div class="cm-fact cm-dim">${cnt} ${cnt === 1 ? 'událost' : cnt < 5 ? 'události' : 'událostí'}</div>`;
      if (events.length) {
        const lines = _wrap(events[0].name, FONT_FACT, IW).slice(0, 1);
        body += `<div class="cm-fact">${_esc(lines[0])}${_wrap(events[0].name, FONT_FACT, IW).length > 1 ? '…' : ''}</div>`;
      }
    }

    const modClass  = isDead ? ' cm-dead' : '';
    return `<div class="cm-cloud${modClass}" data-id="${c.id}" data-type="character"
              style="--cc:${fColor}; width:${CW}px">
      <div class="cm-strip">${badge} ${_esc(faction)}</div>
      <div class="cm-name">${deadMark}${_esc(name)}</div>
      <div class="cm-divider"></div>
      ${body}
    </div>`;
  }

  function _mysteryCloudHTML(m) {
    const priColor = m.priority === 'kritická' ? '#C62828'
                   : m.priority === 'vysoká'   ? '#E65100'
                   : '#8A5CC8';
    const q = (m.questions || [])[0] || '';
    let qHTML = '';
    if (q) {
      const lines = _wrap(q, FONT_FACT, IW).slice(0, 2);
      const snippet = lines.join(' ') + (lines.length < _wrap(q, FONT_FACT, IW).length ? '…' : '');
      qHTML = `<div class="cm-fact cm-hint">${_esc(snippet)}</div>`;
    }
    return `<div class="cm-cloud cm-mystery" data-id="${m.id}" data-type="mystery"
              style="--cc:#6A1B9A; width:${CW}px">
      <div class="cm-strip">❓ Záhada</div>
      <div class="cm-name">${_esc(m.name)}</div>
      <div class="cm-divider"></div>
      <div class="cm-fact" style="color:${priColor};font-size:10px">⚑ ${_esc(m.priority || 'střední')}</div>
      ${qHTML}
    </div>`;
  }

  function _eventCloudHTML(e) {
    const desc = e.short || e.description || e.name;
    const lines = _wrap(desc, FONT_FACT, IW).slice(0, 2);
    const snippet = lines.join(' ') + (lines.length < _wrap(desc, FONT_FACT, IW).length ? '…' : '');
    return `<div class="cm-cloud cm-event" data-id="${e.id}" data-type="event"
              style="--cc:#8B6914; width:${CW}px">
      <div class="cm-strip">📜 Událost ${e.order ? '#' + e.order : ''}</div>
      <div class="cm-name">${_esc(e.name)}</div>
      <div class="cm-divider"></div>
      <div class="cm-fact cm-dim">${_esc(snippet)}</div>
    </div>`;
  }

  function _esc(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ── Edge definitions ────────────────────────────────────────
  const EDGE_COLORS = {
    commands:    '#8B0000', ally:        '#2E7D32', enemy:       '#C62828',
    mission:     '#E65100', mystery:     '#6A1B9A', captured_by: '#0D47A1',
    history:     '#555555', uncertain:   '#757575', negotiates:  '#1565C0',
    located_at:  '#5D7A3A',
  };
  const EDGE_STYLES = {
    commands:    { 'line-style': 'solid',  width: 3 },
    ally:        { 'line-style': 'solid',  width: 2 },
    enemy:       { 'line-style': 'solid',  width: 2 },
    mission:     { 'line-style': 'dashed', width: 2 },
    mystery:     { 'line-style': 'dotted', width: 2 },
    captured_by: { 'line-style': 'solid',  width: 2 },
    history:     { 'line-style': 'dashed', width: 1 },
    uncertain:   { 'line-style': 'dashed', width: 1 },
    negotiates:  { 'line-style': 'dashed', width: 2 },
    member:      { 'line-style': 'dashed', width: 1.5 },
    located_at:  { 'line-style': 'dotted', width: 2 },
  };

  const EDGE_TYPE_LABELS = {
    commands:'velí', ally:'spojenec', enemy:'nepřítel', mission:'mise',
    mystery:'záhada', captured_by:'zajat/a', history:'historie',
    uncertain:'nejistota', negotiates:'jednání',
  };

  function _relEdge(r) {
    const es = EDGE_STYLES[r.type] || {};
    return {
      data: {
        id:        `${r.source}-${r.target}-${r.type}`,
        source:    r.source,
        target:    r.target,
        label:     r.label || EDGE_TYPE_LABELS[r.type] || r.type,
        color:     EDGE_COLORS[r.type] || '#666',
        width:     es.width || 2,
        lineStyle: es['line-style'] || 'solid',
      }
    };
  }

  // ── Layout persistence ───────────────────────────────────────
  // Saved node positions key per map mode, stored in localStorage.
  const LS_POS_PREFIX    = 'cm_pos_';
  const LS_FILTER_PREFIX = 'cm_filter_';
  let   _currentMode     = null;

  function _savePosKey()    { return LS_POS_PREFIX    + _currentMode; }
  function _saveFilterKey() { return LS_FILTER_PREFIX + _currentMode; }

  function _savePositions() {
    if (!_cy || !_currentMode) return;
    const pos = {};
    _cy.nodes().forEach(n => { pos[n.id()] = n.position(); });
    try {
      localStorage.setItem(_savePosKey(), JSON.stringify(pos));
      localStorage.setItem(_saveFilterKey(), JSON.stringify([..._hiddenFactions]));
    } catch(e) {}
  }

  function _loadPositions() {
    if (!_currentMode) return null;
    try {
      const raw = localStorage.getItem(_savePosKey());
      if (!raw) return null;
      const savedFilter = localStorage.getItem(_saveFilterKey());
      if (savedFilter) _hiddenFactions = new Set(JSON.parse(savedFilter));
      return JSON.parse(raw);
    } catch(e) { return null; }
  }

  function _clearPositions() {
    if (!_currentMode) return;
    localStorage.removeItem(_savePosKey());
    localStorage.removeItem(_saveFilterKey());
    _hiddenFactions = new Set();
  }

  // ── Faction filter state ─────────────────────────────────────
  let _hiddenFactions = new Set();

  function _toggleFaction(fId) {
    if (_hiddenFactions.has(fId)) _hiddenFactions.delete(fId);
    else _hiddenFactions.add(fId);
    _applyFactionFilter();
  }

  // ── Visual filter state (search / status / knowledge / edge-type / focus) ──
  // These DIM rather than fully hide; faction filter still owns hard-hide.
  // Persisted per mode in localStorage under LS_VFILTER_PREFIX.
  const LS_VFILTER_PREFIX = 'cm_vf_';
  function _vfilterKey() { return LS_VFILTER_PREFIX + _currentMode; }

  let _filters = {
    search: '',
    statuses: new Set(),       // empty = no status filter
    minKnowledge: 0,
    hiddenEdgeTypes: new Set(),
    focusId: null,
    focusHops: 2,
  };
  let _focusMode = false;

  function _loadVFilter() {
    if (!_currentMode) return;
    try {
      const raw = localStorage.getItem(_vfilterKey());
      if (!raw) return;
      const o = JSON.parse(raw);
      _filters.search          = o.search || '';
      _filters.statuses        = new Set(o.statuses || []);
      _filters.minKnowledge    = +o.minKnowledge || 0;
      _filters.hiddenEdgeTypes = new Set(o.hiddenEdgeTypes || []);
      _filters.focusHops       = +o.focusHops || 2;
      _focusMode               = !!o.focusMode;
    } catch (e) {}
  }
  function _saveVFilter() {
    if (!_currentMode) return;
    try {
      localStorage.setItem(_vfilterKey(), JSON.stringify({
        search:          _filters.search,
        statuses:        [..._filters.statuses],
        minKnowledge:    _filters.minKnowledge,
        hiddenEdgeTypes: [..._filters.hiddenEdgeTypes],
        focusHops:       _filters.focusHops,
        focusMode:       _focusMode,
      }));
    } catch (e) {}
  }

  // Returns concatenated searchable text for a node (diacritic-insensitive match).
  function _nodeSearchText(node) {
    const id = node.id(), type = node.data('type');
    if (type === 'character') {
      const c = Store.getCharacter(id);
      if (!c) return '';
      return [c.name, c.title, ...(c.tags || [])].filter(Boolean).join(' ');
    }
    if (type === 'location') {
      const l = Store.getLocation(id);
      if (!l) return '';
      return [l.name, l.region, ...(l.tags || [])].filter(Boolean).join(' ');
    }
    if (type === 'mystery') {
      const m = Store.getMystery(id);
      if (!m) return '';
      return [m.name, ...(m.questions || [])].filter(Boolean).join(' ');
    }
    if (type === 'event') {
      const e = Store.getEvent(id);
      if (!e) return '';
      return [e.name, e.short, e.description].filter(Boolean).join(' ');
    }
    if (type === 'faction') {
      const fId = id.replace(/^hub_/, '');
      const f = Store.getFactions()[fId];
      return f ? [f.name, f.badge].filter(Boolean).join(' ') : '';
    }
    return '';
  }

  // Best-effort: resolve a Cytoscape edge to a relationship-type string for
  // the edge-type filter. Returns null when no meaningful type applies.
  function _edgeRelType(edge) {
    const id = edge.id();
    if (id.startsWith('mbr_'))   return 'member';
    if (id.startsWith('loc_'))   return 'located_at';
    if (id.startsWith('chain-')) return 'chain';
    if (id.includes('__'))       return 'participation';
    // Pattern: src-tgt-reltype  (relationship edges from _relEdge)
    const dash = id.lastIndexOf('-');
    if (dash > 0) {
      const tail = id.slice(dash + 1);
      if (EDGE_TYPE_LABELS[tail] || EDGE_STYLES[tail]) return tail;
    }
    return null;
  }

  // BFS: collect node IDs within `hops` steps of `startId` along undirected edges.
  function _bfsNeighborhood(startId, hops) {
    const visited = new Set([startId]);
    let frontier = [startId];
    for (let h = 0; h < hops; h++) {
      const next = [];
      for (const nid of frontier) {
        const node = _cy.getElementById(nid);
        if (!node || !node.length) continue;
        node.connectedEdges().forEach(e => {
          const other = e.source().id() === nid ? e.target() : e.source();
          const oid = other.id();
          if (!visited.has(oid)) { visited.add(oid); next.push(oid); }
        });
      }
      frontier = next;
      if (!frontier.length) break;
    }
    return visited;
  }

  // Recompute which nodes and edges should be dimmed by the active filters.
  // Uses the existing `faded` class so _syncEdgeLabels() picks up edge dimming
  // for free; wrappers get .cm-vfilter-dim for fast CSS opacity.
  function _applyVisualFilter() {
    if (!_cy) return;
    const q = norm(_filters.search);
    const focusSet = (_focusMode && _filters.focusId)
      ? _bfsNeighborhood(_filters.focusId, _filters.focusHops)
      : null;

    const dim = new Set();
    _cy.nodes().forEach(node => {
      const id   = node.id();
      const type = node.data('type');
      let match = true;

      if (q && !norm(_nodeSearchText(node)).includes(q)) match = false;

      if (match && type === 'character') {
        const c = Store.getCharacter(id);
        if (c) {
          if (_filters.statuses.size && !_filters.statuses.has(c.status || 'unknown')) match = false;
          if (match && _filters.minKnowledge > 0 && (c.knowledge || 0) < _filters.minKnowledge) match = false;
        }
      }

      if (match && focusSet && !focusSet.has(id)) match = false;

      if (!match) dim.add(id);
    });

    _cy.nodes().forEach(node => {
      const id = node.id();
      const isDim = dim.has(id);
      if (isDim) node.addClass('faded');
      else       node.removeClass('faded');
      const wrapper = _cloudMap[id];
      const cloud = wrapper && wrapper.firstElementChild;
      if (cloud) cloud.classList.toggle('cm-vfilter-dim', isDim);
    });

    _cy.edges().forEach(edge => {
      const eType   = _edgeRelType(edge);
      const typeHidden = !!eType && _filters.hiddenEdgeTypes.has(eType);
      const srcDim = edge.source().hasClass('faded');
      const tgtDim = edge.target().hasClass('faded');
      const isDim = typeHidden || srcDim || tgtDim;
      if (isDim) edge.addClass('faded');
      else       edge.removeClass('faded');
    });

    _syncEdgeLabels();
  }

  // Public setters used by inline event handlers in the filter bar.
  const _applyVisualFilterDebounced = debounce(_applyVisualFilter, 80);

  function _setSearch(q) {
    _filters.search = String(q || '');
    _saveVFilter();
    _applyVisualFilterDebounced();
  }
  function _toggleStatus(s) {
    if (_filters.statuses.has(s)) _filters.statuses.delete(s);
    else _filters.statuses.add(s);
    _saveVFilter();
    _syncFilterChipUI();
    _applyVisualFilter();
  }
  function _setMinKnowledge(n) {
    _filters.minKnowledge = Math.max(0, Math.min(4, +n || 0));
    document.querySelectorAll('.cm-knowledge-val').forEach(el => el.textContent = _filters.minKnowledge);
    _saveVFilter();
    _applyVisualFilter();
  }
  function _toggleEdgeType(t) {
    if (_filters.hiddenEdgeTypes.has(t)) _filters.hiddenEdgeTypes.delete(t);
    else _filters.hiddenEdgeTypes.add(t);
    _saveVFilter();
    _syncFilterChipUI();
    _applyVisualFilter();
  }
  function _toggleFocusMode() {
    _focusMode = !_focusMode;
    if (!_focusMode) _filters.focusId = null;
    _saveVFilter();
    _syncFilterChipUI();
    _applyVisualFilter();
  }
  function _setFocusHops(n) {
    _filters.focusHops = Math.max(1, Math.min(4, +n || 2));
    document.querySelectorAll('.cm-focus-hops-val').forEach(el => el.textContent = _filters.focusHops);
    _saveVFilter();
    if (_focusMode && _filters.focusId) _applyVisualFilter();
  }
  function _clearFilters() {
    _filters.search = '';
    _filters.statuses.clear();
    _filters.minKnowledge = 0;
    _filters.hiddenEdgeTypes.clear();
    _filters.focusId = null;
    _focusMode = false;
    _saveVFilter();
    const sb = document.querySelector('.cm-search');
    if (sb) sb.value = '';
    const ks = document.querySelector('.cm-knowledge input[type=range]');
    if (ks) ks.value = 0;
    document.querySelectorAll('.cm-knowledge-val').forEach(el => el.textContent = '0');
    _syncFilterChipUI();
    _applyVisualFilter();
  }

  // Sync chip 'is-on' class to current filter state.
  function _syncFilterChipUI() {
    document.querySelectorAll('.cm-chip[data-status]').forEach(b => {
      b.classList.toggle('is-on', _filters.statuses.has(b.dataset.status));
    });
    document.querySelectorAll('.cm-chip[data-edge-type]').forEach(b => {
      b.classList.toggle('is-off', _filters.hiddenEdgeTypes.has(b.dataset.edgeType));
    });
    const focusBtn = document.querySelector('.cm-focus-toggle');
    if (focusBtn) focusBtn.classList.toggle('is-on', _focusMode);
    const hopsBox = document.querySelector('.cm-focus-hops');
    if (hopsBox) hopsBox.hidden = !_focusMode;
  }

  function _applyFactionFilter() {
    if (!_cy) return;
    // For non-character nodes (location, mystery, event):
    // hide only if ALL connected character/faction nodes are hidden.
    // smartVisible[id] === false  → has connections, all are hidden → hide it
    // smartVisible[id] === true   → at least one visible connection → keep visible
    // smartVisible[id] === undefined → no tracked connections → keep visible
    const smartVisible = {};
    _cy.edges().forEach(edge => {
      const src = edge.source(), tgt = edge.target();
      const srcType = src.data('type'), tgtType = tgt.data('type');

      // Faction hub → location (original logic)
      if (srcType === 'faction' && tgtType === 'location') {
        const fId = src.data('faction');
        const lId = tgt.id();
        if (smartVisible[lId] === undefined) smartVisible[lId] = false;
        if (!_hiddenFactions.has(fId)) smartVisible[lId] = true;
      }

      // Character ↔ mystery or character ↔ event
      const trySmartHide = (charNode, otherNode) => {
        const oType = otherNode.data('type');
        if (charNode.data('type') === 'character' && (oType === 'mystery' || oType === 'event')) {
          const oId = otherNode.id();
          if (smartVisible[oId] === undefined) smartVisible[oId] = false;
          const fId = charNode.data('faction');
          if (!fId || !_hiddenFactions.has(fId)) smartVisible[oId] = true;
        }
      };
      trySmartHide(src, tgt);
      trySmartHide(tgt, src);
    });

    _cy.nodes().forEach(node => {
      const type    = node.data('type');
      const faction = node.data('faction');
      const id      = node.id();
      let hidden = false;

      if (type === 'faction' || type === 'character') {
        hidden = !!faction && _hiddenFactions.has(faction);
      } else if (type === 'location' || type === 'mystery' || type === 'event') {
        // Hidden if explicitly tracked and no visible connection remains
        hidden = smartVisible[id] === false;
      }

      const wrapper = _cloudMap[id];
      if (wrapper) wrapper.style.display = hidden ? 'none' : '';
      // Also set Cytoscape node visibility for edge routing
      if (hidden) node.addClass('cm-filter-hidden');
      else        node.removeClass('cm-filter-hidden');
    });

    // Hide edges where either endpoint is hidden
    _cy.edges().forEach(edge => {
      const hidden = edge.source().hasClass('cm-filter-hidden') ||
                     edge.target().hasClass('cm-filter-hidden');
      if (hidden) edge.addClass('cm-filter-hidden');
      else        edge.removeClass('cm-filter-hidden');
      // Also hide edge labels
      const elObj = _edgeLabels[edge.id()];
      if (elObj) elObj.div.style.display = hidden ? 'none' : '';
    });

    // Hide faction glows for hidden factions (hubs and members)
    Object.entries(_glowMap).forEach(([nodeId, glow]) => {
      const node = _cy.getElementById(nodeId);
      if (!node || !node.length) return;
      glow.style.display = node.hasClass('cm-filter-hidden') ? 'none' : '';
    });
  }

  // ── SVG namespace ────────────────────────────────────────────
  const _NS = 'http://www.w3.org/2000/svg';

  // ── Cytoscape state ─────────────────────────────────────────
  let _cy          = null;
  let _cloudLayer  = null;
  let _edgeSvg     = null; // SVG overlay for custom edge rendering
  let _cloudMap    = {}; // nodeId → wrapper div
  let _edgeLabels  = {}; // edgeId → {div, label, svgEls}
  let _glowMap     = {}; // 'hub_fId' → glow div

  // Inertia tracking
  let _prevPos    = {}; // nodeId → {x,y} at previous drag event
  let _vel        = {}; // nodeId → {vx,vy} in px/frame units
  let _inertiaRaf = {}; // nodeId → rAF id

  function _killInertia(id) {
    if (_inertiaRaf[id]) { cancelAnimationFrame(_inertiaRaf[id]); delete _inertiaRaf[id]; }
  }

  function _destroy() {
    _hideCtxMenu();
    Object.keys(_inertiaRaf).forEach(_killInertia);
    Object.values(_edgeLabels).forEach(({ div, svgEls }) => {
      if (div) div.remove();
      if (svgEls) svgEls.forEach(el => el.remove());
    });
    if (_cy) { _cy.destroy(); _cy = null; }
    _cloudLayer = null;
    _edgeSvg    = null;
    _cloudMap   = {};
    _edgeLabels = {};
    _glowMap    = {};
    _prevPos    = {};
    _vel        = {};
    _inertiaRaf = {};
  }

  // ── UI scaffold ─────────────────────────────────────────────
  function _buildFactionFilterLegend(factions, exclude = new Set()) {
    return Object.entries(factions)
      .filter(([fId]) => !exclude.has(fId))
      .map(([fId, f]) => `
        <label class="legend-item legend-filter" data-faction="${fId}">
          <input type="checkbox" ${_hiddenFactions.has(fId) ? '' : 'checked'}
                 onchange="CloudMap.toggleFaction('${fId}')">
          <div class="legend-dot" style="background:${f.color}"></div>
          ${f.badge} ${_esc(f.name)}
        </label>`).join('');
  }

  function _buildUI(mode) {
    _currentMode = mode;
    _hiddenFactions = new Set(); // reset; _loadPositions() may repopulate from localStorage
    // Reset visual filter then load saved state for this mode
    _filters = { search: '', statuses: new Set(), minKnowledge: 0,
                 hiddenEdgeTypes: new Set(), focusId: null, focusHops: 2 };
    _focusMode = false;
    _loadVFilter();

    document.getElementById('main-content').style.display = '';
    document.getElementById('main-content').innerHTML = `
      <div class="map-container">
        <div class="map-toolbar">
          <div class="map-title">☁ Myšlenkový Palác</div>
          <a href="#/mapa/frakce"    class="map-mode-btn ${mode==='frakce'    ?'active':''}">Frakce</a>
          <a href="#/mapa/vztahy"    class="map-mode-btn ${mode==='vztahy'    ?'active':''}">Vztahy</a>
          <a href="#/mapa/mista"     class="map-mode-btn ${mode==='mista'     ?'active':''}">Místa</a>
          <a href="#/mapa/tajemstvi" class="map-mode-btn ${mode==='tajemstvi' ?'active':''}">Záhady</a>
          <button class="map-mode-btn cm-save-pos" onclick="CloudMap.resetLayout()" title="Vymaže uložené pozice a znovu rozloží uzly automaticky">⟳ Rozložení</button>
          <button class="map-mode-btn cm-save-pos" onclick="CloudMap.savePositions()" title="Uloží aktuální pozice uzlů">💾 Uložit pozice</button>
          <span class="map-hint">Klik = detail · Táhni = pohyb · Scroll = zoom</span>
        </div>
        ${_buildFilterBar(mode)}
        <div id="cy-container"></div>
        <div class="map-legend" id="map-legend"></div>
      </div>
    `;
  }

  // Per-mode toolbar row with search, status/knowledge/edge chips, focus toggle.
  function _buildFilterBar(mode) {
    const statusMap = Store.getStatusMap();
    const statusChips = Object.entries(statusMap).map(([key, s]) => {
      const on = _filters.statuses.has(key) ? ' is-on' : '';
      return `<button type="button" class="cm-chip${on}" data-status="${key}"
        onclick="CloudMap.toggleStatus('${key}')" title="${_esc(s.label)}"
        style="--chip-color:${s.color || '#888'}">${s.icon || ''} ${_esc(s.label)}</button>`;
    }).join('');

    // Edge-type chips depend on mode
    let edgeChips = '';
    const buildEdgeChip = (t, label, color) => {
      const off = _filters.hiddenEdgeTypes.has(t) ? ' is-off' : '';
      return `<button type="button" class="cm-chip cm-chip-edge${off}" data-edge-type="${t}"
        onclick="CloudMap.toggleEdgeType('${t}')" style="--chip-color:${color}">${_esc(label)}</button>`;
    };
    if (mode === 'vztahy') {
      edgeChips = [
        ['commands','velí',EDGE_COLORS.commands], ['ally','spojenec',EDGE_COLORS.ally],
        ['enemy','nepřítel',EDGE_COLORS.enemy], ['mission','mise',EDGE_COLORS.mission],
        ['mystery','záhada',EDGE_COLORS.mystery], ['negotiates','jednání',EDGE_COLORS.negotiates],
        ['captured_by','zajat',EDGE_COLORS.captured_by], ['history','minulost',EDGE_COLORS.history],
        ['uncertain','nejistota',EDGE_COLORS.uncertain],
      ].map(([t,l,c]) => buildEdgeChip(t,l,c)).join('');
    } else if (mode === 'frakce') {
      edgeChips = [
        ['member','frakce','#888'], ['located_at','lokace','#5D7A3A'],
        ['commands','velí',EDGE_COLORS.commands], ['negotiates','jednání',EDGE_COLORS.negotiates],
        ['ally','spojenec',EDGE_COLORS.ally],
      ].map(([t,l,c]) => buildEdgeChip(t,l,c)).join('');
    }

    const focusOn = _focusMode ? ' is-on' : '';
    return `
      <div class="map-filterbar">
        <input type="text" class="cm-search" placeholder="🔍 Hledat (jméno, tag, region…)"
               value="${_esc(_filters.search)}"
               oninput="CloudMap.setSearch(this.value)">
        ${statusChips ? `<div class="cm-chip-group" title="Filtr podle stavu">${statusChips}</div>` : ''}
        <label class="cm-knowledge" title="Skrýt postavy se znalostí pod prahem">
          <span>Znalost ≥</span>
          <input type="range" min="0" max="4" step="1" value="${_filters.minKnowledge}"
                 oninput="CloudMap.setMinKnowledge(this.value)">
          <span class="cm-knowledge-val">${_filters.minKnowledge}</span>
        </label>
        ${edgeChips ? `<div class="cm-chip-group cm-chip-group-edge" title="Skrýt typy vazeb">${edgeChips}</div>` : ''}
        <button type="button" class="cm-focus-toggle${focusOn}"
                onclick="CloudMap.toggleFocusMode()"
                title="Klik na uzel zaměří jeho okolí místo otevření detailu">🎯 Fokus</button>
        <span class="cm-focus-hops" ${_focusMode ? '' : 'hidden'}>
          <input type="range" min="1" max="4" step="1" value="${_filters.focusHops}"
                 oninput="CloudMap.setFocusHops(this.value)">
          <span class="cm-focus-hops-val">${_filters.focusHops}</span> hop
        </span>
        <button type="button" class="cm-clear-filters" onclick="CloudMap.clearFilters()"
                title="Vymazat všechny filtry">⨯</button>
      </div>`;
  }

  // ── Cytoscape init ───────────────────────────────────────────
  function _initCy(elements, layout) {
    if (_cy) _cy.destroy();

    // If we have saved positions, use a preset layout instead of physics
    const savedPos = _loadPositions();
    if (savedPos) {
      // Inject saved positions into node data so preset layout can use them
      elements = elements.map(el => {
        if (el.data && el.data.id && savedPos[el.data.id]) {
          return { ...el, position: savedPos[el.data.id] };
        }
        return el;
      });
      layout = { name: 'preset', fit: false, padding: 70 };
    }

    const container = document.getElementById('cy-container');
    container.style.position = 'relative'; // needed for absolute cloud layer

    _cy = cytoscape({
      container,
      elements,
      style: [
        {
          // Invisible proxy node — sized to match the cloud card.
          // shape:rectangle tells Cytoscape to route edges to the actual
          // rectangle boundary, not to a circumscribed ellipse.
          selector: 'node',
          style: {
            'width':              'data(w)',
            'height':             'data(h)',
            'shape':              'rectangle',
            'background-opacity': 0,
            'border-width':       0,
            'label':              '',
            'min-zoomed-font-size': 0,
          }
        },
        {
          // Native edges are hidden — we render them as SVG with gaps for labels.
          // Cytoscape edges still exist for layout/physics; visuals are in _edgeSvg.
          selector: 'edge',
          style: {
            'width':         0,
            'opacity':       0,
            'line-opacity':  0,
            'arrow-scale':   0,
            'overlay-opacity': 0,
          }
        },
        // Fading/highlighting only affects nodes (edges are drawn in SVG)
        { selector: 'node.faded',       style: { opacity: 0.07 } },
        { selector: 'node.highlighted', style: { opacity: 1    } },
        { selector: '.cm-filter-hidden', style: { opacity: 0, 'events': 'no' } },
      ],
      layout,
      minZoom: 0.18,
      maxZoom: 3,
      userZoomingEnabled:  true,
      userPanningEnabled:  true,
      boxSelectionEnabled: false,
    });

    // Cloud layer — added AFTER Cytoscape so it sits on top in DOM
    _cloudLayer = document.createElement('div');
    _cloudLayer.id = 'cloud-layer';
    _cloudLayer.style.cssText =
      'position:absolute;inset:0;pointer-events:none;' +
      'transform-origin:0 0;overflow:visible;z-index:5;';
    container.appendChild(_cloudLayer);

    // SVG edge layer — lives inside cloud layer, inserted first so it renders
    // below glow divs and cloud cards. Edges are drawn here with gaps for labels.
    _edgeSvg = document.createElementNS(_NS, 'svg');
    _edgeSvg.setAttribute('class', 'cm-edge-svg');
    _edgeSvg.style.cssText =
      'position:absolute;left:0;top:0;overflow:visible;pointer-events:none;';
    _edgeSvg.setAttribute('width', '0');
    _edgeSvg.setAttribute('height', '0');
    // Insert as first child of cloud layer so everything else renders on top
    _cloudLayer.insertBefore(_edgeSvg, _cloudLayer.firstChild);

    return _cy;
  }

  // ── Cloud placement ─────────────────────────────────────────
  function _addCloud(html, id) {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'position:absolute;pointer-events:none;';
    wrapper.innerHTML = html;
    _cloudLayer.appendChild(wrapper);
    _cloudMap[id] = wrapper;
  }

  // Proxy node helper
  function _proxy(id, type, w, h, extra) {
    return { data: { id, type, w, h, ...extra } };
  }

  // ── Viewport sync ────────────────────────────────────────────
  function _sync() {
    if (!_cy || !_cloudLayer) return;
    const pan  = _cy.pan();
    const zoom = _cy.zoom();
    _cloudLayer.style.transform = `translate(${pan.x}px,${pan.y}px) scale(${zoom})`;

    _cy.nodes().forEach(node => {
      const id = node.id();
      const wrapper = _cloudMap[id];
      if (!wrapper) return;
      const pos = node.position();
      const w   = node.data('w');
      const h   = node.data('h');
      wrapper.style.left = (pos.x - w / 2) + 'px';
      wrapper.style.top  = (pos.y - h / 2) + 'px';

      // Sync faction glow position
      const glow = _glowMap[id];
      if (glow) {
        const gs = glow.classList.contains('cm-glow-sm') ? 320 : 550;
        glow.style.left = (pos.x - gs / 2) + 'px';
        glow.style.top  = (pos.y - gs / 2) + 'px';
      }
    });

    _syncEdgeLabels();
  }

  // ── SVG edge rendering + HTML labels with true line gaps ───────
  // Cytoscape edges are hidden (opacity 0). We draw edges as SVG lines
  // inside _edgeSvg (which lives in the cloud layer, below clouds).
  // Labelled edges are split into two segments with a gap for the text.
  // HTML label divs sit in that gap, centred on the edge midpoint.

  const EDGE_LABEL_FONT   = '12px Inter, sans-serif';
  const EDGE_LABEL_LINE_H = 12 * 1.35;
  const LABEL_GAP_PAD     = 5;   // extra gap each side beyond text bounds

  function _dashArray(lineStyle, width) {
    if (lineStyle === 'dashed') return `${width * 4},${width * 3}`;
    if (lineStyle === 'dotted') return `${width},${width * 2.5}`;
    return '';
  }

  // Marker geometry — sizes in graph-coordinate units (userSpaceOnUse)
  const MARKER_TRI_W  = 14;   // triangle arrow length along edge
  const MARKER_TRI_H  = 10;   // triangle arrow width perpendicular to edge
  const MARKER_CIRC_R = 4.5;  // circle radius at source end
  const MARKER_CIRC_D = MARKER_CIRC_R * 2;
  // How far to inset line endpoints so markers don't overlap clouds
  const INSET_SRC     = MARKER_CIRC_R;       // circle centre sits on the line end
  const INSET_TGT     = MARKER_TRI_W - 1;    // triangle tip at refX, pull back

  // Ensure SVG marker definitions exist for a given colour
  function _ensureMarkers(color, markerId) {
    if (_edgeSvg.querySelector(`#${markerId}-tri`)) return;
    let defs = _edgeSvg.querySelector('defs');
    if (!defs) {
      defs = document.createElementNS(_NS, 'defs');
      _edgeSvg.insertBefore(defs, _edgeSvg.firstChild);
    }
    // Triangle target arrow — tip is at refX (right edge of the marker box)
    const mTri = document.createElementNS(_NS, 'marker');
    mTri.setAttribute('id', `${markerId}-tri`);
    mTri.setAttribute('markerWidth', MARKER_TRI_W);
    mTri.setAttribute('markerHeight', MARKER_TRI_H);
    mTri.setAttribute('refX', MARKER_TRI_W);
    mTri.setAttribute('refY', MARKER_TRI_H / 2);
    mTri.setAttribute('orient', 'auto');
    mTri.setAttribute('markerUnits', 'userSpaceOnUse');
    const tri = document.createElementNS(_NS, 'path');
    tri.setAttribute('d', `M0,0 L${MARKER_TRI_W},${MARKER_TRI_H / 2} L0,${MARKER_TRI_H} Z`);
    tri.setAttribute('fill', color);
    mTri.appendChild(tri);
    defs.appendChild(mTri);
    // Circle source marker — centred on the line start
    const mCirc = document.createElementNS(_NS, 'marker');
    mCirc.setAttribute('id', `${markerId}-circ`);
    mCirc.setAttribute('markerWidth', MARKER_CIRC_D);
    mCirc.setAttribute('markerHeight', MARKER_CIRC_D);
    mCirc.setAttribute('refX', MARKER_CIRC_R);
    mCirc.setAttribute('refY', MARKER_CIRC_R);
    mCirc.setAttribute('orient', 'auto');
    mCirc.setAttribute('markerUnits', 'userSpaceOnUse');
    const circ = document.createElementNS(_NS, 'circle');
    circ.setAttribute('cx', MARKER_CIRC_R);
    circ.setAttribute('cy', MARKER_CIRC_R);
    circ.setAttribute('r', MARKER_CIRC_R);
    circ.setAttribute('fill', color);
    mCirc.appendChild(circ);
    defs.appendChild(mCirc);
  }

  // Returns the point where a ray from (cx,cy) in unit direction (udx,udy)
  // exits the axis-aligned rectangle centred at (cx,cy) with half-sizes (hw,hh).
  // Used to find where an edge leaves/enters each cloud card boundary.
  function _rectIntersect(cx, cy, hw, hh, udx, udy) {
    const tx = udx !== 0 ? hw / Math.abs(udx) : Infinity;
    const ty = udy !== 0 ? hh / Math.abs(udy) : Infinity;
    const t  = Math.min(tx, ty);
    return { x: cx + udx * t, y: cy + udy * t };
  }

  // Pill = horizontal stadium: flat top/bottom, semicircle caps at left/right.
  function _pillIntersect(cx, cy, hw, hh, udx, udy) {
    const r      = hh;                        // cap radius = half-height
    const flatHW = Math.max(0, hw - r);       // half-width of the flat portion
    const tx     = udx !== 0 ? flatHW / Math.abs(udx) : Infinity;
    const ty     = udy !== 0 ? hh / Math.abs(udy) : Infinity;
    if (tx < ty && udx !== 0) {
      // Exits through a semicircle cap
      const capCx = cx + Math.sign(udx) * flatHW;
      const t = r / Math.hypot(udx, udy);
      return { x: capCx + udx * t, y: cy + udy * t };
    }
    // Exits through flat top/bottom
    const t = Math.min(tx, ty);
    return { x: cx + udx * t, y: cy + udy * t };
  }

  // Choose intersection function based on node type
  function _nodeIntersect(node, cx, cy, hw, hh, udx, udy) {
    if (node.data('type') === 'faction') return _pillIntersect(cx, cy, hw, hh, udx, udy);
    return _rectIntersect(cx, cy, hw, hh, udx, udy);
  }

  function _addEdgeLabels() {
    // Clean up previous edge labels and SVG elements
    Object.values(_edgeLabels).forEach(({ div, svgEls }) => {
      if (div) div.remove();
      if (svgEls) svgEls.forEach(el => el.remove());
    });
    _edgeLabels = {};
    // Clear old marker defs
    if (_edgeSvg) {
      const oldDefs = _edgeSvg.querySelector('defs');
      if (oldDefs) oldDefs.remove();
    }

    _cy.edges().forEach(edge => {
      const label  = edge.data('label') || '';
      const color  = edge.data('color') || '#666';
      const width  = edge.data('width') || 2;
      const lStyle = edge.data('lineStyle') || 'solid';
      const eid    = edge.id();

      // Marker ID from colour (strip non-alphanumeric for valid SVG id)
      const markerId = 'mk-' + color.replace(/[^a-zA-Z0-9]/g, '');
      _ensureMarkers(color, markerId);

      // Two SVG line segments per edge (line1: src→gap, line2: gap→tgt)
      const line1 = document.createElementNS(_NS, 'line');
      const line2 = document.createElementNS(_NS, 'line');
      const baseStyle = `stroke:${color};stroke-width:${width};opacity:0.82;stroke-linecap:round;`;
      line1.setAttribute('style', baseStyle);
      line2.setAttribute('style', baseStyle);
      const dash = _dashArray(lStyle, width);
      if (dash) {
        line1.setAttribute('stroke-dasharray', dash);
        line2.setAttribute('stroke-dasharray', dash);
      }
      _edgeSvg.appendChild(line1);
      _edgeSvg.appendChild(line2);

      // HTML label div
      const div = document.createElement('div');
      div.className = 'cm-edge-label';
      if (label) {
        div.textContent = label;
        div.style.color = color;
      }
      _cloudLayer.appendChild(div);

      _edgeLabels[eid] = { div, label, svgEls: [line1, line2], markerId };
    });
  }

  function _syncEdgeLabels() {
    Object.entries(_edgeLabels).forEach(([eid, rec]) => {
      const { div, label, svgEls, markerId } = rec;
      const [line1, line2] = svgEls;
      const edge = _cy.getElementById(eid);

      // Hide everything if edge gone or filter-hidden
      if (!edge || !edge.length || edge.hasClass('cm-filter-hidden')) {
        div.style.visibility = 'hidden';
        line1.setAttribute('visibility', 'hidden');
        line2.setAttribute('visibility', 'hidden');
        return;
      }

      const srcNode = edge.source();
      const tgtNode = edge.target();
      // Also hide if either endpoint is filter-hidden
      if (srcNode.hasClass('cm-filter-hidden') || tgtNode.hasClass('cm-filter-hidden')) {
        div.style.visibility = 'hidden';
        line1.setAttribute('visibility', 'hidden');
        line2.setAttribute('visibility', 'hidden');
        return;
      }

      const sp = srcNode.position();
      const tp = tgtNode.position();

      const dx  = tp.x - sp.x;
      const dy  = tp.y - sp.y;
      const len = Math.hypot(dx, dy) || 1;
      const udx = dx / len;
      const udy = dy / len;

      const srcRaw   = _nodeIntersect(srcNode, sp.x, sp.y,
                         srcNode.data('w') / 2, srcNode.data('h') / 2,  udx,  udy);
      const tgtRaw   = _nodeIntersect(tgtNode, tp.x, tp.y,
                         tgtNode.data('w') / 2, tgtNode.data('h') / 2, -udx, -udy);

      // Inset endpoints so markers sit just outside the cloud boundary
      const srcExit  = { x: srcRaw.x + udx * INSET_SRC, y: srcRaw.y + udy * INSET_SRC };
      const tgtEntry = { x: tgtRaw.x - udx * INSET_TGT, y: tgtRaw.y - udy * INSET_TGT };

      const visLen = Math.hypot(tgtRaw.x - srcRaw.x, tgtRaw.y - srcRaw.y);

      // Hide when clouds overlap
      if (visLen < 10) {
        div.style.visibility = 'hidden';
        line1.setAttribute('visibility', 'hidden');
        line2.setAttribute('visibility', 'hidden');
        return;
      }

      line1.setAttribute('visibility', 'visible');
      line2.setAttribute('visibility', 'visible');

      // Mirror Cytoscape faded/highlighted opacity on SVG lines + label
      const isFaded = edge.hasClass('faded');
      const svgOpacity = isFaded ? 0.07 : 0.82;
      line1.style.opacity = svgOpacity;
      line2.style.opacity = svgOpacity;
      div.style.opacity = isFaded ? 0.07 : 1;

      // Midpoint of the raw boundary gap (for label placement at true visual centre)
      const mx = (srcRaw.x + tgtRaw.x) / 2;
      const my = (srcRaw.y + tgtRaw.y) / 2;

      if (label && visLen > 50) {
        // ── Labelled edge: split into two segments with gap ──
        div.style.visibility = 'visible';

        const labelW = Math.max(36, visLen - 20);
        div.style.width = labelW + 'px';

        // Measure wrapped text to determine gap size along edge direction
        const lines = _wrap(label, EDGE_LABEL_FONT, labelW);
        const textH = lines.length * EDGE_LABEL_LINE_H;
        // Gap half-length: how far from midpoint in each direction
        // Use the longest wrapped line width (not the container) for tighter gap
        let maxLineW = 0;
        for (const ln of lines) {
          _ctx.font = EDGE_LABEL_FONT;
          maxLineW = Math.max(maxLineW, _ctx.measureText(ln).width);
        }
        const gapHalfLen = Math.min(
          (maxLineW / 2 + LABEL_GAP_PAD),
          visLen / 2 - 4
        );

        const gapStart = { x: mx - udx * gapHalfLen, y: my - udy * gapHalfLen };
        const gapEnd   = { x: mx + udx * gapHalfLen, y: my + udy * gapHalfLen };

        // Segment 1: source → gap start (with source circle marker)
        line1.setAttribute('x1', srcExit.x);
        line1.setAttribute('y1', srcExit.y);
        line1.setAttribute('x2', gapStart.x);
        line1.setAttribute('y2', gapStart.y);
        line1.setAttribute('marker-start', `url(#${markerId}-circ)`);
        line1.removeAttribute('marker-end');

        // Segment 2: gap end → target (with target triangle marker)
        line2.setAttribute('x1', gapEnd.x);
        line2.setAttribute('y1', gapEnd.y);
        line2.setAttribute('x2', tgtEntry.x);
        line2.setAttribute('y2', tgtEntry.y);
        line2.removeAttribute('marker-start');
        line2.setAttribute('marker-end', `url(#${markerId}-tri)`);
        line2.setAttribute('visibility', 'visible');

        // Position label at midpoint, rotated to follow edge
        let angle = Math.atan2(dy, dx) * 180 / Math.PI;
        if (angle > 90 || angle < -90) angle += angle > 0 ? -180 : 180;
        div.style.transform = `translate(-50%, -50%) rotate(${angle}deg)`;
        div.style.left = mx + 'px';
        div.style.top  = my + 'px';
      } else {
        // ── Unlabelled or too-short: single line, no gap ──
        div.style.visibility = 'hidden';

        line1.setAttribute('x1', srcExit.x);
        line1.setAttribute('y1', srcExit.y);
        line1.setAttribute('x2', tgtEntry.x);
        line1.setAttribute('y2', tgtEntry.y);
        line1.setAttribute('marker-start', `url(#${markerId}-circ)`);
        line1.setAttribute('marker-end', `url(#${markerId}-tri)`);

        line2.setAttribute('visibility', 'hidden');
      }
    });
  }

  // ── Squish helper ────────────────────────────────────────────
  // Applies a CSS animation to the cloud card for a tactile collision feel.
  // horizontal=true → squish left/right (X compressed); false → squish up/down.
  function _squish(nodeId, horizontal) {
    const wrapper = _cloudMap[nodeId];
    if (!wrapper) return;
    const cloud = wrapper.firstElementChild;
    if (!cloud) return;
    const cls = horizontal ? 'cm-squish-x' : 'cm-squish-y';
    cloud.classList.remove('cm-squish-x', 'cm-squish-y');
    void cloud.offsetWidth; // force reflow so the animation restarts cleanly
    cloud.classList.add(cls);
  }

  // ── Bounce + velocity tracking ───────────────────────────────
  function _bounce(evt) {
    const dragged = evt.target;
    const id      = dragged.id();
    const dp      = dragged.position();
    const dHW     = dragged.data('w') / 2 + 10;
    const dHH     = dragged.data('h') / 2 + 10;

    // Track per-frame velocity from consecutive drag positions
    if (_prevPos[id]) {
      _vel[id] = {
        vx: (dp.x - _prevPos[id].x) * 0.75,
        vy: (dp.y - _prevPos[id].y) * 0.75,
      };
    }
    _prevPos[id] = { x: dp.x, y: dp.y };

    _cy.nodes().forEach(other => {
      if (other.id() === id) return;
      const op  = other.position();
      const oHW = other.data('w') / 2 + 10;
      const oHH = other.data('h') / 2 + 10;

      const ox = (dHW + oHW) - Math.abs(dp.x - op.x);
      const oy = (dHH + oHH) - Math.abs(dp.y - op.y);

      if (ox > 0 && oy > 0) {
        const dx = dp.x - op.x;
        const dy = dp.y - op.y;
        const horizontal = ox < oy;
        let nx, ny;
        if (horizontal) {
          nx = op.x - Math.sign(dx || 1) * (ox + 5);
          ny = op.y;
        } else {
          nx = op.x;
          ny = op.y - Math.sign(dy || 1) * (oy + 5);
        }
        // Squish both the dragged and the hit cloud along the collision axis
        _squish(id,          horizontal);
        _squish(other.id(),  horizontal);

        other.animate(
          { position: { x: nx, y: ny } },
          { duration: 200, easing: 'ease-out-cubic', queue: false }
        );
      }
    });
  }

  // ── Inertia (coast after release) ────────────────────────────
  function _onDragFree(evt) {
    const n  = evt.target;
    const id = n.id();
    const v  = _vel[id];
    if (!v || (Math.abs(v.vx) < 0.4 && Math.abs(v.vy) < 0.4)) return;

    let vx = v.vx;
    let vy = v.vy;
    const FRICTION  = 0.88; // multiply per frame; ~0.88^20 ≈ 0.08 → stops in ~20 frames
    const MIN_SPEED = 0.3;

    function step() {
      const speed = Math.hypot(vx, vy);
      if (speed < MIN_SPEED) { delete _inertiaRaf[id]; return; }
      vx *= FRICTION;
      vy *= FRICTION;
      n.position({ x: n.position().x + vx, y: n.position().y + vy });
      _inertiaRaf[id] = requestAnimationFrame(step);
    }

    _killInertia(id);
    _inertiaRaf[id] = requestAnimationFrame(step);
  }

  // ── Tap / highlight ──────────────────────────────────────────
  function _onTap(evt) {
    // Tap on background → clear focus / temporary highlights, keep persistent filters
    if (evt.target === _cy) {
      if (_focusMode && _filters.focusId) {
        _filters.focusId = null;
        _saveVFilter();
      }
      Object.values(_cloudMap).forEach(w => {
        w.firstElementChild && w.firstElementChild.classList.remove('cm-highlighted');
      });
      _applyVisualFilter();
      return;
    }

    const node = evt.target;
    if (!node.isNode()) return;

    // Focus mode: zaměří okolí, žádná navigace
    if (_focusMode) {
      _filters.focusId = node.id();
      _saveVFilter();
      _applyVisualFilter();
      const wrapper = _cloudMap[node.id()];
      if (wrapper && wrapper.firstElementChild) {
        wrapper.firstElementChild.classList.add('cm-highlighted');
      }
      return;
    }

    // Standard behavior: 1-hop highlight then navigate
    const connected = node.connectedEdges().connectedNodes().union(node);
    const ids       = new Set(connected.map(n => n.id()));

    _cy.elements().removeClass('faded highlighted');
    _cy.elements().not(connected).addClass('faded');
    connected.addClass('highlighted');

    Object.entries(_cloudMap).forEach(([id, wrapper]) => {
      const cloud = wrapper.firstElementChild;
      if (!cloud) return;
      if (ids.has(id)) {
        cloud.classList.remove('cm-faded');
        cloud.classList.add('cm-highlighted');
      } else {
        cloud.classList.remove('cm-highlighted');
        cloud.classList.add('cm-faded');
      }
    });

    // Navigate to the item's detail page (after a short delay so highlight shows)
    const d = node.data();
    setTimeout(() => {
      if (d.type === 'character') window.location.hash = `#/postava/${d.id}`;
      if (d.type === 'mystery')   window.location.hash = `#/zahada/${d.id}`;
      if (d.type === 'event')     window.location.hash = `#/udalost/${d.id}`;
      if (d.type === 'faction')   window.location.hash = `#/frakce/${d.id.replace('hub_', '')}`;
      if (d.type === 'location')  window.location.hash = `#/misto/${d.id}`;
    }, 120);
  }

  // ── Right-click context menu ─────────────────────────────────
  // Singleton menu element appended to <body>; rebuilt per invocation.
  let _ctxMenu = null;

  function _hideCtxMenu() {
    if (_ctxMenu) { _ctxMenu.remove(); _ctxMenu = null; }
  }

  function _detailHashFor(d) {
    if (d.type === 'character') return `#/postava/${d.id}`;
    if (d.type === 'mystery')   return `#/zahada/${d.id}`;
    if (d.type === 'event')     return `#/udalost/${d.id}`;
    if (d.type === 'faction')   return `#/frakce/${d.id.replace('hub_','')}`;
    if (d.type === 'location')  return `#/misto/${d.id}`;
    return null;
  }

  function _onCtxNode(evt) {
    _hideCtxMenu();
    const node = evt.target;
    const d = node.data();
    const isFocused = _focusMode && _filters.focusId === node.id();

    const items = [];
    const hash = _detailHashFor(d);
    if (hash) items.push({ label: '↗ Otevřít detail', action: () => { window.location.hash = hash; } });

    if (isFocused) {
      items.push({ label: '⨯ Zrušit fokus', action: () => {
        _filters.focusId = null;
        _saveVFilter();
        _applyVisualFilter();
      }});
    } else {
      items.push({ label: '🎯 Zaměřit okolí', action: () => {
        _focusMode = true;
        _filters.focusId = node.id();
        _saveVFilter();
        _syncFilterChipUI();
        _applyVisualFilter();
        const wrapper = _cloudMap[node.id()];
        if (wrapper && wrapper.firstElementChild) {
          wrapper.firstElementChild.classList.add('cm-highlighted');
        }
      }});
    }

    if (d.type === 'location' && _currentMode !== 'mista') {
      items.push({ label: '📍 Otevřít v módu Místa', action: () => {
        window.location.hash = '#/mapa/mista';
      }});
    }
    if (d.type === 'character' && _currentMode !== 'vztahy') {
      items.push({ label: '🔗 Zobrazit vazby', action: () => {
        window.location.hash = '#/mapa/vztahy';
      }});
    }
    if (d.type === 'character') {
      items.push({ label: '➕ Přidat vazbu odsud', action: () => {
        // Land on the character page; in edit mode the relationship form
        // is rendered inline and pre-focused on the new-row.
        window.location.hash = `#/postava/${d.id}`;
        // Best-effort: scroll to the new-row after the page renders.
        setTimeout(() => {
          const row = document.querySelector(`#rel-section-${d.id} .rel-add-form`);
          if (row) {
            row.scrollIntoView({ behavior: 'smooth', block: 'center' });
            row.querySelector('select')?.focus();
          }
        }, 250);
      }});
    }

    // Position menu near cursor (use rendered position from cytoscape event)
    const oe = evt.originalEvent;
    const x = oe ? oe.clientX : 100;
    const y = oe ? oe.clientY : 100;
    _showCtxMenu(items, x, y);
  }

  function _showCtxMenu(items, x, y) {
    _ctxMenu = document.createElement('div');
    _ctxMenu.className = 'cm-ctx-menu';
    _ctxMenu.innerHTML = items.map((it, i) =>
      `<button type="button" class="cm-ctx-item" data-idx="${i}">${_esc(it.label)}</button>`
    ).join('');
    _ctxMenu.addEventListener('click', e => {
      const btn = e.target.closest('.cm-ctx-item');
      if (!btn) return;
      const idx = +btn.dataset.idx;
      const it = items[idx];
      _hideCtxMenu();
      if (it && it.action) it.action();
    });
    document.body.appendChild(_ctxMenu);

    // Clamp inside viewport
    const rect = _ctxMenu.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const cx = Math.min(x, vw - rect.width  - 6);
    const cy = Math.min(y, vh - rect.height - 6);
    _ctxMenu.style.left = Math.max(4, cx) + 'px';
    _ctxMenu.style.top  = Math.max(4, cy) + 'px';

    // One-shot dismiss on next outside click / Esc / scroll
    setTimeout(() => {
      const dismiss = (e) => {
        if (_ctxMenu && _ctxMenu.contains(e.target)) return;
        _hideCtxMenu();
        document.removeEventListener('mousedown', dismiss);
        document.removeEventListener('keydown',   onEsc);
        window.removeEventListener('blur',        offBlur);
      };
      const onEsc = (e) => { if (e.key === 'Escape') dismiss(e); };
      const offBlur = () => dismiss({ target: document.body });
      document.addEventListener('mousedown', dismiss);
      document.addEventListener('keydown',   onEsc);
      window.addEventListener('blur',        offBlur);
    }, 0);
  }

  // ── Post-render height correction ────────────────────────────
  // Pre-layout estimates can be slightly off due to font rendering.
  // After the first DOM paint we measure each cloud's real offsetHeight
  // and patch both the Cytoscape node style (edge routing) and node data
  // (used by _rectIntersect for label positioning).
  function _resizeToActual() {
    _cy.batch(() => {
      _cy.nodes().forEach(node => {
        const wrapper = _cloudMap[node.id()];
        if (!wrapper) return;
        const cloud = wrapper.firstElementChild;
        if (!cloud) return;
        const h = cloud.offsetHeight;
        if (h > 0 && h !== node.data('h')) {
          node.data('h', h);
          node.style('height', h);
        }
      });
    });
  }

  // ── Shared event binding ─────────────────────────────────────
  function _bind() {
    _cy.on('render',           _sync);
    _cy.on('dragstart', 'node', evt => {
      const id = evt.target.id();
      _killInertia(id);         // cancel any existing coast
      delete _prevPos[id];      // reset velocity tracking
      delete _vel[id];
    });
    _cy.on('drag',    'node',  _bounce);
    _cy.on('dragfree','node',  evt => { _onDragFree(evt); });
    _cy.on('tap',              _onTap);
    _cy.on('cxttap',  'node',  _onCtxNode);
    _cy.on('cxttap',           evt => { if (evt.target === _cy) _hideCtxMenu(); });

    // ── Smooth zoom — override Cytoscape's coarse wheel zoom ──────
    // Cytoscape's built-in wheel step (~15–20 % per tick) feels jumpy.
    // We disable it and apply a finer step (6 %) ourselves, zooming
    // toward the cursor position exactly as Cytoscape would.
    _cy.userZoomingEnabled(false);
    const _container = _cy.container();
    _container.addEventListener('wheel', evt => {
      evt.preventDefault();

      const FACTOR = 0.06;                           // 6 % per scroll tick
      const delta  = evt.deltaY < 0 ? 1 + FACTOR : 1 / (1 + FACTOR);
      const oldZ   = _cy.zoom();
      const newZ   = Math.min(_cy.maxZoom(), Math.max(_cy.minZoom(), oldZ * delta));
      if (newZ === oldZ) return;

      // Zoom toward the cursor (keep the graph point under the pointer fixed)
      const rect  = _container.getBoundingClientRect();
      const cx    = evt.clientX - rect.left;
      const cy_px = evt.clientY - rect.top;

      _cy.zoom({
        level:    newZ,
        renderedPosition: { x: cx, y: cy_px },
      });
    }, { passive: false });

    _cy.ready(() => {
      _addEdgeLabels();
      _sync();
      // One rAF later the clouds are painted — measure, correct heights, then save positions
      requestAnimationFrame(() => {
        _resizeToActual();
        _sync();
        // Apply persisted visual filters (search/status/knowledge/edge-type/focus)
        _syncFilterChipUI();
        if (_filters.search || _filters.statuses.size || _filters.minKnowledge ||
            _filters.hiddenEdgeTypes.size || (_focusMode && _filters.focusId)) {
          _applyVisualFilter();
        }
        // Positions are saved manually via the "Uložit pozice" button in edit mode
      });
    });
  }

  // ── MODE: FRAKCE ────────────────────────────────────────────
  // Central faction hub nodes + member nodes + location nodes.
  // Edges: hub→member, hub→location, commands, negotiates, ally.
  function _renderFrakce() {
    _buildUI('frakce');

    // Clear stale positions from before hub/location nodes were added
    const POS_VERSION_KEY = 'cm_pos_v_frakce';
    if (localStorage.getItem(POS_VERSION_KEY) !== '2') {
      localStorage.removeItem('cm_pos_frakce');
      localStorage.setItem(POS_VERSION_KEY, '2');
    }

    const chars    = Store.getCharacters();
    const factions = Store.getFactions();
    const allRels  = Store.getRelationships();
    const locations = Store.getLocations();
    const facLocMap = _deriveFactionLocations(chars);

    // — Count members per faction —
    const memberCounts = {};
    chars.forEach(c => { memberCounts[c.faction] = (memberCounts[c.faction] || 0) + 1; });

    // — Faction hub nodes (skip "neutral") —
    const HIDDEN_HUB_FACTIONS = new Set(['neutral']);
    const hubNodes = Object.entries(factions)
      .filter(([fId]) => !HIDDEN_HUB_FACTIONS.has(fId))
      .map(([fId, f]) =>
        _proxy('hub_' + fId, 'faction', CW_HUB, _factionHubCloudH(f, memberCounts[fId] || 0),
          { faction: fId })
      );

    // — Character nodes —
    const charNodes = chars.map(c =>
      _proxy(c.id, 'character', CW, _charCloudH(c, 'frakce'), { faction: c.faction })
    );

    // — Determine command-chain roots per faction —
    // A "root" is a character NOT commanded by someone in the same faction.
    const cmdRels = allRels.filter(r => r.type === 'commands');
    const commandedByFaction = new Set(); // charIds that have a same-faction commander
    cmdRels.forEach(r => {
      const src = chars.find(c => c.id === r.source);
      const tgt = chars.find(c => c.id === r.target);
      if (src && tgt && src.faction === tgt.faction) {
        commandedByFaction.add(tgt.id);
      }
    });

    // — Location nodes (deduplicated) —
    const usedLocIds = new Set();
    facLocMap.forEach(locSet => locSet.forEach(id => usedLocIds.add(id)));
    const locNodes = [];
    for (const locId of usedLocIds) {
      const loc = locations.find(l => l.id === locId);
      if (loc) locNodes.push(_proxy(loc.id, 'location', CW, _locationCloudH(loc), {}));
    }

    // — Edges —
    const edges = [];

    // Hub → member edges (only to chain roots, skip factions without hubs)
    chars.forEach(c => {
      if (!c.faction || !factions[c.faction]) return;
      if (HIDDEN_HUB_FACTIONS.has(c.faction)) return;       // no hub for neutral
      if (commandedByFaction.has(c.id)) return;              // connected via command chain
      const fColor = _factionColor(c.faction);
      edges.push({
        data: {
          id: `mbr_${c.faction}_${c.id}`, source: 'hub_' + c.faction, target: c.id,
          label: '', color: fColor, width: 1.5, lineStyle: 'dashed',
        }
      });
    });

    // Hub → location edges (dotted, earthy green; skip factions without hubs)
    facLocMap.forEach((locSet, fId) => {
      if (HIDDEN_HUB_FACTIONS.has(fId)) return;
      for (const locId of locSet) {
        if (!locations.find(l => l.id === locId)) continue;
        edges.push({
          data: {
            id: `loc_${fId}_${locId}`, source: 'hub_' + fId, target: locId,
            label: '', color: '#5D7A3A', width: 2, lineStyle: 'dotted',
          }
        });
      }
    });

    // Commands + negotiates between characters
    const relEdges = allRels
      .filter(r => r.type === 'commands' || r.type === 'negotiates' || r.type === 'ally')
      .map(_relEdge);
    edges.push(...relEdges);

    // — Layout —
    _initCy([...hubNodes, ...charNodes, ...locNodes, ...edges], {
      name: 'cose', animate: true, animationDuration: 700,
      nodeRepulsion: 24000, gravity: 0.12, idealEdgeLength: 200,
      padding: 90, randomize: false, numIter: 3000,
    });

    // — Faction glow divs (inserted first so they render behind clouds) —
    // Hub glows: large and brighter; member glows: smaller and subtler
    Object.entries(factions).forEach(([fId, f]) => {
      if (HIDDEN_HUB_FACTIONS.has(fId)) return;
      const glow = document.createElement('div');
      glow.className = 'cm-glow';
      glow.style.cssText = `--gc:${f.color};`;
      _cloudLayer.insertBefore(glow, _cloudLayer.firstChild);
      _glowMap['hub_' + fId] = glow;
    });
    chars.forEach(c => {
      if (!c.faction || !factions[c.faction]) return;
      const f = factions[c.faction];
      const glow = document.createElement('div');
      glow.className = 'cm-glow cm-glow-sm';
      glow.style.cssText = `--gc:${f.color};`;
      _cloudLayer.insertBefore(glow, _cloudLayer.firstChild);
      _glowMap[c.id] = glow;
    });

    // — Add cloud cards —
    Object.entries(factions).forEach(([fId, f]) => {
      if (HIDDEN_HUB_FACTIONS.has(fId)) return;
      _addCloud(_factionHubCloudHTML(fId, f, memberCounts[fId] || 0), 'hub_' + fId);
    });
    chars.forEach(c => _addCloud(_charCloudHTML(c, 'frakce'), c.id));
    for (const locId of usedLocIds) {
      const loc = locations.find(l => l.id === locId);
      if (loc) _addCloud(_locationCloudHTML(loc), loc.id);
    }

    _bind();
    _addEdgeLabels();

    // — Legend with faction filter checkboxes —
    const leg = document.getElementById('map-legend');
    if (leg) {
      leg.innerHTML = `
        <div class="legend-title">Frakce</div>
        ${_buildFactionFilterLegend(factions, HIDDEN_HUB_FACTIONS)}
        <div class="legend-item">
          <div class="legend-dot" style="background:#5D7A3A"></div>
          📍 Místo
        </div>
        <div class="legend-item" style="margin-top:0.4rem;opacity:0.55">
          <div class="legend-dot" style="background:#666;border:1px dashed #888"></div>
          Mrtvý
        </div>
        <div style="margin-top:0.5rem">
          <div class="legend-title">Vazby</div>
          <div class="legend-item"><div class="legend-line" style="border-top:1.5px dashed #888"></div> Člen frakce</div>
          <div class="legend-item"><div class="legend-line" style="border-top:3px solid #8B0000"></div> Velení</div>
          <div class="legend-item"><div class="legend-line" style="border-top:2px dashed #1565C0"></div> Jednání</div>
          <div class="legend-item"><div class="legend-line" style="border-top:2px solid #2E7D32"></div> Spojenec</div>
          <div class="legend-item"><div class="legend-line" style="border-top:2px dotted #5D7A3A"></div> Lokace</div>
        </div>`;

      if (_hiddenFactions.size) _applyFactionFilter();
    }
  }

  // ── MODE: VZTAHY ────────────────────────────────────────────
  // Clouds show: faction strip, name, status, connection count, top types.
  // Edges: all relationships with labels.
  function _renderVztahy() {
    _buildUI('vztahy');
    const chars    = Store.getCharacters();
    const rels     = Store.getRelationships();
    const factions = Store.getFactions();

    const nodes = chars.map(c =>
      _proxy(c.id, 'character', CW, _charCloudH(c, 'vztahy'))
    );
    const edges = rels.map(_relEdge);

    _initCy([...nodes, ...edges], {
      name: 'cose', animate: true, animationDuration: 900,
      nodeRepulsion: 22000, gravity: 0.07, idealEdgeLength: 220,
      padding: 90, randomize: false, numIter: 3000,
    });

    chars.forEach(c => _addCloud(_charCloudHTML(c, 'vztahy'), c.id));
    _bind();

    const typeRows = [
      ['commands','Velení'], ['ally','Spojenec'], ['enemy','Nepřítel'],
      ['mission','Mise'],    ['mystery','Záhada'], ['history','Minulost'],
    ].map(([t, l]) => {
      const es = EDGE_STYLES[t] || {};
      const c  = EDGE_COLORS[t] || '#666';
      const d  = es['line-style'] || 'solid';
      return `<div class="legend-item">
        <div class="legend-line" style="border-top:2px ${d} ${c}"></div>${l}
      </div>`;
    }).join('');

    const leg = document.getElementById('map-legend');
    if (leg) {
      leg.innerHTML = `
        <div class="legend-title">Typy vazeb</div>
        ${typeRows}
        <div class="legend-title" style="margin-top:0.5rem">Frakce</div>
        ${_buildFactionFilterLegend(factions)}`;
      if (_hiddenFactions.size) _applyFactionFilter();
    }
  }

  // ── MODE: ZÁHADY ────────────────────────────────────────────
  // Mystery clouds (purple) + character clouds showing mystery context.
  function _renderTajemstvi() {
    _buildUI('tajemstvi');
    const mysteries = Store.getMysteries();
    const chars     = Store.getCharacters();
    const factions  = Store.getFactions();

    const involvedIds = new Set(mysteries.flatMap(m => m.characters || []));
    const involved    = chars.filter(c => involvedIds.has(c.id));

    const mNodes = mysteries.map(m =>
      _proxy(m.id, 'mystery', CW, _mysteryCloudH(m))
    );
    const cNodes = involved.map(c =>
      _proxy(c.id, 'character', CW, _charCloudH(c, 'tajemstvi'))
    );
    const edges = mysteries.flatMap(m =>
      (m.characters || []).map(cid => ({
        data: {
          id: `${m.id}__${cid}`, source: m.id, target: cid,
          label: '', color: '#7B2FA0', width: 1.5, lineStyle: 'dotted',
        }
      }))
    );

    _initCy([...mNodes, ...cNodes, ...edges], {
      name: 'cose', animate: true, animationDuration: 700,
      nodeRepulsion: 16000, gravity: 0.22, idealEdgeLength: 180,
      padding: 65,
    });

    mysteries.forEach(m => _addCloud(_mysteryCloudHTML(m), m.id));
    involved.forEach(c  => _addCloud(_charCloudHTML(c, 'tajemstvi'), c.id));
    _bind();
    _addEdgeLabels();

    const leg = document.getElementById('map-legend');
    if (leg) {
      leg.innerHTML = `
        <div class="legend-title">Záhady</div>
        <div class="legend-item"><div class="legend-dot" style="background:#6A1B9A"></div> Záhada</div>
        <div class="legend-item"><div class="legend-dot"></div> Zapojená postava</div>
        <div class="legend-title" style="margin-top:0.5rem">Frakce</div>
        ${_buildFactionFilterLegend(factions)}`;
      if (_hiddenFactions.size) _applyFactionFilter();
    }
  }

  // ── MODE: ČASOVÁ OSA ────────────────────────────────────────
  // Event clouds (gold) linked chronologically + characters showing their event history.
  function _renderCasovaOsa() {
    _buildUI('casova-osa');
    const events    = [...Store.getEvents()].sort((a, b) => a.order - b.order);
    const chars     = Store.getCharacters();
    const factions  = Store.getFactions();

    const involvedIds = new Set(events.flatMap(e => e.characters || []));
    const involved    = chars.filter(c => involvedIds.has(c.id));

    const eNodes = events.map(e =>
      _proxy(e.id, 'event', CW, _eventCloudH(e))
    );
    const cNodes = involved.map(c =>
      _proxy(c.id, 'character', CW, _charCloudH(c, 'casova-osa'))
    );

    // Chronological chain between events
    const chainEdges = events.slice(0, -1).map((e, i) => ({
      data: {
        id: `chain-${i}`, source: e.id, target: events[i + 1].id,
        label: '', color: '#C8A040', width: 2, lineStyle: 'solid',
      }
    }));
    // Event ↔ character participation edges
    const partEdges = events.flatMap(e =>
      (e.characters || []).map(cid => ({
        data: {
          id: `${e.id}__${cid}`, source: e.id, target: cid,
          label: '', color: '#555', width: 1, lineStyle: 'dotted',
        }
      }))
    );

    _initCy([...eNodes, ...cNodes, ...chainEdges, ...partEdges], {
      name: 'cose', animate: true, animationDuration: 800,
      nodeRepulsion: 14000, gravity: 0.18, idealEdgeLength: 190,
      padding: 65,
    });

    events.forEach(e  => _addCloud(_eventCloudHTML(e), e.id));
    involved.forEach(c => _addCloud(_charCloudHTML(c, 'casova-osa'), c.id));
    _bind();
    _addEdgeLabels();

    const leg = document.getElementById('map-legend');
    if (leg) {
      leg.innerHTML = `
        <div class="legend-title">Časová Osa</div>
        <div class="legend-item">
          <div class="legend-line" style="border-top:2px solid #C8A040"></div> Sled událostí
        </div>
        <div class="legend-item"><div class="legend-dot" style="background:#8B6914"></div> Událost</div>
        <div class="legend-item"><div class="legend-dot"></div> Postava</div>
        <div class="legend-title" style="margin-top:0.5rem">Frakce</div>
        ${_buildFactionFilterLegend(factions)}`;
      if (_hiddenFactions.size) _applyFactionFilter();
    }
  }

  // ── MODE: MÍSTA ─────────────────────────────────────────────
  // Locations as primary nodes; edges from each location's connections[].
  // Each card shows region + status + character chips (inhabitants).
  function _renderMista() {
    _buildUI('mista');
    const locations = Store.getLocations();
    const locById = new Map(locations.map(l => [l.id, l]));

    const nodes = locations.map(l =>
      _proxy(l.id, 'location', CW, _locationCloudH(l, 'mista'))
    );

    // Dedupe undirected connections by sorted pair key
    const seen = new Set();
    const edges = [];
    locations.forEach(l => {
      (l.connections || []).forEach(toId => {
        if (!locById.has(toId) || toId === l.id) return;
        const key = [l.id, toId].sort().join('|');
        if (seen.has(key)) return;
        seen.add(key);
        edges.push({
          data: {
            id: `con_${key}`,
            source: l.id, target: toId,
            label: '', color: '#5D7A3A', width: 2, lineStyle: 'solid',
          }
        });
      });
    });

    _initCy([...nodes, ...edges], {
      name: 'cose', animate: true, animationDuration: 700,
      nodeRepulsion: 18000, gravity: 0.16, idealEdgeLength: 220,
      padding: 80, randomize: false, numIter: 3000,
    });

    locations.forEach(l => _addCloud(_locationCloudHTML(l, 'mista'), l.id));
    _bind();
    _addEdgeLabels();

    const leg = document.getElementById('map-legend');
    if (leg) {
      leg.innerHTML = `
        <div class="legend-title">Místa</div>
        <div class="legend-item">
          <div class="legend-dot" style="background:#5D7A3A"></div> Místo
        </div>
        <div class="legend-item">
          <div class="legend-line" style="border-top:2px solid #5D7A3A"></div> Spojení
        </div>
        <div class="legend-item" style="margin-top:0.4rem;color:var(--text-muted)">
          Štítky uvnitř karty ukazují postavy v místě.
        </div>`;
    }
  }

  // ── Public ────────────────────────────────────────────────
  function render(mode) {
    _destroy();
    switch (mode) {
      case 'frakce':     _renderFrakce();     break;
      case 'vztahy':     _renderVztahy();     break;
      case 'mista':      _renderMista();      break;
      case 'tajemstvi':  _renderTajemstvi();  break;
      case 'casova-osa': _renderCasovaOsa();  break;
      default:           _renderFrakce();
    }
  }

  // Clear saved positions for current mode and re-render with fresh physics layout
  function resetLayout() {
    _clearPositions();
    if (_currentMode) render(_currentMode);
  }

  return {
    render, resetLayout,
    savePositions:   _savePositions,
    toggleFaction:   _toggleFaction,
    setSearch:       _setSearch,
    toggleStatus:    _toggleStatus,
    setMinKnowledge: _setMinKnowledge,
    toggleEdgeType:  _toggleEdgeType,
    toggleFocusMode: _toggleFocusMode,
    setFocusHops:    _setFocusHops,
    clearFilters:    _clearFilters,
  };
})();

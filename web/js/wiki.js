// ═══════════════════════════════════════════════════════════════
//  WIKI — renders character, location and event articles.
//  Uses Store for all data. Checks EditMode.isActive() to switch
//  between read-only view and inline edit forms.
// ═══════════════════════════════════════════════════════════════

import { Store } from './store.js';
import { EditMode } from './editmode.js';
import { norm, esc, renderMarkdown } from './utils.js';
import { PIN_TYPES } from './map.js';

export const Wiki = (() => {

  const KNOWLEDGE_LABELS = ["Neznámý","Tušený","Základní","Dobře znám","Plně zmapován"];

  // ── List-view UI state (search + sort) ─────────────────────────
  // Persisted so SSE re-renders and navigation keep the user's filter.
  // Search is multi-chip via TagFilter: values[] AND-matched against
  // a per-entity text blob (name + tags + type + description + …).
  const LS_LIST_KEY = 'wiki_list_state_v1';
  const _defaultListState = {
    postavy: { values: [], sort: 'faction' },
    mista:   { values: [], sort: 'name' },
    frakce:  { values: [], sort: 'default' },
  };
  function _migrateSlot(def, raw) {
    const slot = { ...def, ...(raw || {}) };
    // Back-compat: old shape used a single `q` string.
    if (typeof slot.q === 'string' && !Array.isArray(slot.values)) {
      slot.values = slot.q ? [slot.q] : [];
    }
    delete slot.q;
    if (!Array.isArray(slot.values)) slot.values = [];
    return slot;
  }
  let _listState = (() => {
    try {
      const s = JSON.parse(localStorage.getItem(LS_LIST_KEY) || '{}');
      return {
        postavy: _migrateSlot(_defaultListState.postavy, s.postavy),
        mista:   _migrateSlot(_defaultListState.mista,   s.mista),
        frakce:  _migrateSlot(_defaultListState.frakce,  s.frakce),
      };
    } catch { return JSON.parse(JSON.stringify(_defaultListState)); }
  })();
  function _persistListState() {
    try { localStorage.setItem(LS_LIST_KEY, JSON.stringify(_listState)); } catch {}
  }

  // AND-match: every chip must be a substring of the normalized blob.
  function _matchAll(values, blob) {
    if (!values || !values.length) return true;
    const b = norm(blob || '');
    return values.every(v => {
      const n = norm(v);
      return n ? b.includes(n) : true;
    });
  }

  // Shared toolbar: TagFilter (name + tags, unified) + sort <select>.
  // Re-renders only the matching grid-host div via the delegated
  // tf-change listener / Wiki.set<Kind>Sort, so focus never jumps.
  function _listToolbar(kind, sortOpts) {
    const s = _listState[kind];
    const opts = sortOpts.map(([v, label]) =>
      `<option value="${v}" ${s.sort===v?'selected':''}>${label}</option>`
    ).join('');
    const Name = kind[0].toUpperCase() + kind.slice(1);
    return `
      <div class="list-toolbar">
        <div class="tf-mount list-search-tf"
             data-tf-id="wl-${kind}-tf"
             data-tf-placeholder="🔍 Napiš a stiskni Enter…"
             data-tf-hint="Jméno, tagy, typ — víc chipů = všechny musí sedět"
             data-tf-value="${esc((s.values || []).join(','))}"
             data-wl-kind="${kind}"></div>
        <label class="list-sort">
          <span class="list-sort-label">Řadit</span>
          <select class="list-sort-select" onchange="Wiki.set${Name}Sort(this.value)">
            ${opts}
          </select>
        </label>
      </div>`;
  }

  // One-shot delegated listener: every tf-mount inside a list toolbar
  // reports chip changes here, and we route to the matching grid refresh.
  document.addEventListener('tf-change', (ev) => {
    const el = ev.target;
    if (!el || !el.classList || !el.classList.contains('list-search-tf')) return;
    const kind = el.dataset.wlKind;
    if (!kind || !_listState[kind]) return;
    _listState[kind].values = Array.isArray(ev.detail?.values) ? [...ev.detail.values] : [];
    _persistListState();
    if (kind === 'postavy') { _refreshPostavyGrid(); _refreshPostavyCount(); }
    else if (kind === 'mista')   { _refreshMistaGrid();   _refreshMistaCount(); }
    else if (kind === 'frakce')  { _refreshFrakceGrid();  _refreshFrakceCount(); }
  });

  // Czech-aware name compare. Falls back to default locale if `cs` not supported.
  const _czCompare = (a, b) => String(a||'').localeCompare(String(b||''), 'cs');

  function factionBadge(factionId) {
    const f = Store.getFactions()[factionId] || Store.getFactions().neutral;
    return `<span class="badge badge-faction" style="background:${f.color}22;color:${f.textColor};border:1px solid ${f.color}55">
      ${f.badge} ${f.name}</span>`;
  }

  function statusBadge(statusId) {
    const s = Store.getStatusMap()[statusId] || Store.getStatusMap().unknown;
    return `<span class="badge badge-status-${statusId}">${s.icon} ${s.label}</span>`;
  }

  function knowledgeBadge(lvl) {
    return `<span class="badge badge-knowledge">👁 ${KNOWLEDGE_LABELS[lvl] || "?"}</span>`;
  }

  function relationLabel(type) {
    return {
      commands:"velí", ally:"spojenec/kyně", enemy:"nepřítel", mission:"mise",
      mystery:"záhada", captured_by:"zajat/a", history:"historie",
      uncertain:"nejasná vazba", negotiates:"vyjednává",
    }[type] || type;
  }

  // ── Portrait wrapper (knowledge + dead overlay) ────────────────
  function portraitWrap(c, extraClass) {
    const factions  = Store.getFactions();
    const deadHtml  = c.status === "dead" ? `<div class="dead-overlay">💀</div>` : "";
    const imgHtml   = c.portrait
      ? `<img class="portrait-img" src="${c.portrait}" alt="${c.name}" loading="lazy">`
      : `<div class="portrait-placeholder">${factions[c.faction]?.badge || "👤"}</div>`;
    return `<div class="portrait-wrap${extraClass ? " "+extraClass : ""}" data-knowledge="${c.knowledge}" data-status="${c.status}">
      ${imgHtml}${deadHtml}
    </div>`;
  }

  // ── Edit overlay on cards (only visible in edit mode) ─────────
  function editOverlay(href) {
    return `<span class="edit-card-overlay" title="Upravit">✏</span>`;
  }

  // ══════════════════════════════════════════════════════════════
  //  DASHBOARD
  // ══════════════════════════════════════════════════════════════
  function renderDashboard() {
    const chars     = Store.getCharacters();
    const mysteries = Store.getMysteries();
    const totalChars    = chars.length;
    const knownChars    = chars.filter(c => c.knowledge >= 3).length;
    const openMysteries = mysteries.length;
    const capturedCount = chars.filter(c => c.status === "captured").length;

    return `
      <div class="text-center" style="padding-top:1rem">
        <div class="dashboard-title">O Barvách Draků</div>
        <div class="dashboard-subtitle">Kodex Kampaně</div>
        <div class="dashboard-divider"></div>
      </div>

      <div class="dash-section-title">Mind Mapy</div>
      <div class="dashboard-grid">
        <a href="#/mapa/frakce"     class="dash-card" style="text-decoration:none">
          <div class="dash-card-icon">⬡</div>
          <div class="dash-card-title">Frakce &amp; Hierarchie</div>
          <div class="dash-card-desc">Kdo patří kam. Hierarchie Dračího Kultu, naše parta, greenestské postavy a draci.</div>
        </a>
        <a href="#/mapa/vztahy"    class="dash-card" style="text-decoration:none">
          <div class="dash-card-icon">🕸</div>
          <div class="dash-card-title">Vztahová Síť</div>
          <div class="dash-card-desc">Osobní vazby mezi postavami — spojenectví, nepřátelství, záhady.</div>
        </a>
        <a href="#/mapa/tajemstvi" class="dash-card" style="text-decoration:none">
          <div class="dash-card-icon">❓</div>
          <div class="dash-card-title">Záhady &amp; Stopy</div>
          <div class="dash-card-desc">Otevřené otázky a co k nim víme. ${openMysteries} aktivních záhad.</div>
        </a>
        <a href="#/casova-osa" class="dash-card" style="text-decoration:none">
          <div class="dash-card-icon">📜</div>
          <div class="dash-card-title">Časová Osa</div>
          <div class="dash-card-desc">Události kampaně v chronologickém pořadí s propojením na postavy.</div>
        </a>
      </div>

      <div class="dash-section-title" style="margin-top:2rem">Rychlý Přehled</div>
      <div class="dashboard-grid" style="grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:0.75rem">
        <a href="#/postavy" class="dash-card" style="text-decoration:none;text-align:center">
          <div style="font-size:2rem;margin-bottom:0.35rem">👤</div>
          <div class="dash-card-title" style="font-size:1.6rem;margin-bottom:0">${totalChars}</div>
          <div class="dash-card-desc">Postav</div>
        </a>
        <div class="dash-card" style="text-align:center">
          <div style="font-size:2rem;margin-bottom:0.35rem">👁</div>
          <div class="dash-card-title" style="font-size:1.6rem;margin-bottom:0">${knownChars}</div>
          <div class="dash-card-desc">Dobře zmapovaných</div>
        </div>
        <div class="dash-card" style="text-align:center;border-color:rgba(106,27,154,0.3)">
          <div style="font-size:2rem;margin-bottom:0.35rem">❓</div>
          <div class="dash-card-title" style="font-size:1.6rem;margin-bottom:0;color:#ce93d8">${openMysteries}</div>
          <div class="dash-card-desc">Záhad</div>
        </div>
        <div class="dash-card" style="text-align:center;border-color:rgba(21,101,192,0.3)">
          <div style="font-size:2rem;margin-bottom:0.35rem">⛓</div>
          <div class="dash-card-title" style="font-size:1.6rem;margin-bottom:0;color:#90caf9">${capturedCount}</div>
          <div class="dash-card-desc">Zajatých</div>
        </div>
      </div>

      <div class="dash-section-title" style="margin-top:2rem">Kritické Záhady</div>
      <div class="mystery-list">
        ${mysteries.filter(m => m.priority === "kritická" || m.priority === "vysoká").map(m => `
          <div class="mystery-card">
            <div class="mystery-name">❓ ${m.name}</div>
            <div class="mystery-priority priority-${m.priority}">${m.priority.toUpperCase()}</div>
            <div class="mystery-desc md-view">${renderMarkdown(m.description)}</div>
          </div>`).join("")}
      </div>
    `;
  }

  // ══════════════════════════════════════════════════════════════
  //  CHARACTER LIST
  // ══════════════════════════════════════════════════════════════
  const FACTION_ORDER = ["party","cult_high","cult_red","dragon","greenest","neutral","mystery"];
  const STATUS_ORDER  = { alive: 0, captured: 1, unknown: 2, dead: 3 };

  // Apply current search + sort to the character list. `filterFaction` is
  // the faction filter-bar selection (orthogonal to text search).
  function _postavyApply(filterFaction) {
    const s = _listState.postavy;
    let chars = Store.getCharacters();
    if (s.values && s.values.length) {
      chars = chars.filter(c => _matchAll(s.values,
        `${c.name||''} ${c.title||''} ${(c.tags||[]).join(' ')} ${c.description||''} ${c.species||''} ${c.gender||''}`));
    }
    if (filterFaction) chars = chars.filter(c => c.faction === filterFaction);
    chars = [...chars];
    switch (s.sort) {
      case 'name':
        chars.sort((a, b) => _czCompare(a.name, b.name));
        break;
      case 'status':
        chars.sort((a, b) =>
          (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9)
          || _czCompare(a.name, b.name));
        break;
      case 'knowledge':
        chars.sort((a, b) =>
          (b.knowledge ?? 0) - (a.knowledge ?? 0) || _czCompare(a.name, b.name));
        break;
      case 'faction':
      default:
        chars.sort((a, b) => {
          const ai = FACTION_ORDER.indexOf(a.faction);
          const bi = FACTION_ORDER.indexOf(b.faction);
          return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
            || _czCompare(a.name, b.name);
        });
    }
    return chars;
  }

  function _postavyGridHtml(filterFaction) {
    const chars = _postavyApply(filterFaction);
    const newCard = EditMode.isActive() ? `
      <a class="char-card char-card-new" href="#/postava/new" style="text-decoration:none">
        <div class="char-card-new-icon">＋</div>
        <div class="char-card-new-label">Nová postava</div>
      </a>` : "";
    const emptyMsg = chars.length === 0
      ? `<div class="list-empty">Žádná postava neodpovídá hledání.</div>` : "";
    return `${chars.map(renderCharacterCard).join("")}${emptyMsg}${newCard}`;
  }

  function renderCharacterList(filterFaction) {
    _listState.postavy.faction = filterFaction || null;
    _persistListState();

    const factions = Store.getFactions();
    const allChars = Store.getCharacters();

    const filters = Object.entries(factions).map(([id, f]) => {
      const count = allChars.filter(c => c.faction === id).length;
      if (count === 0) return "";
      return `<button class="filter-btn ${filterFaction === id ? "active" : ""}"
        onclick="Wiki.renderPage('postavy','${id}')">${f.badge} ${f.name} (${count})</button>`;
    }).join("");

    const shown = _postavyApply(filterFaction);

    return `
      <div class="page-header">
        <h1>Postavy</h1>
        <div class="subtitle">${shown.length} / ${allChars.length} záznamů${filterFaction ? " · " + factions[filterFaction]?.name : ""}</div>
      </div>
      <div class="filter-bar">
        <button class="filter-btn ${!filterFaction ? "active" : ""}" onclick="Wiki.renderPage('postavy')">Všechny</button>
        ${filters}
      </div>
      ${_listToolbar('postavy', [
        ['faction',   'Frakce'],
        ['name',      'Jméno (A→Z)'],
        ['status',    'Status'],
        ['knowledge', 'Znalost (nejvíc)'],
      ])}
      <div class="char-grid" id="wl-postavy-grid">${_postavyGridHtml(filterFaction)}</div>
    `;
  }

  // Legacy shim: old callers passed a single string. Treat as a
  // one-chip filter so inline-HTML that survived the refactor still works.
  function setPostavySearch(v) {
    const arr = Array.isArray(v) ? v : (v ? [String(v)] : []);
    _listState.postavy.values = arr;
    _persistListState();
    _refreshPostavyGrid();
    _refreshPostavyCount();
  }
  function setPostavySort(v) {
    _listState.postavy.sort = v || 'faction';
    _persistListState();
    _refreshPostavyGrid();
  }
  function _refreshPostavyGrid() {
    const host = document.getElementById('wl-postavy-grid');
    if (host) host.innerHTML = _postavyGridHtml(_listState.postavy.faction);
  }
  function _refreshPostavyCount() {
    const total = Store.getCharacters().length;
    const shown = _postavyApply(_listState.postavy.faction).length;
    const sub = document.querySelector('.page-header .subtitle');
    if (!sub) return;
    const f = _listState.postavy.faction;
    const fLabel = f ? " · " + (Store.getFactions()[f]?.name || '') : "";
    sub.textContent = `${shown} / ${total} záznamů${fLabel}`;
  }

  function renderCharacterCard(c) {
    const overlay = EditMode.isActive() ? editOverlay(`#/postava/${c.id}`) : "";
    return `
      <a class="char-card" href="#/postava/${c.id}" style="text-decoration:none;position:relative">
        ${portraitWrap(c)}
        ${overlay}
        <div class="char-card-info">
          <div class="char-card-name">${c.knowledge >= 1 ? c.name : "???"}</div>
          <div class="char-card-title">${c.knowledge >= 2 ? c.title : "Neznámá"}</div>
          <div class="char-card-badges">${statusBadge(c.status)}</div>
        </div>
      </a>
    `;
  }

  // ══════════════════════════════════════════════════════════════
  //  CHARACTER ARTICLE
  // ══════════════════════════════════════════════════════════════
  function renderCharacterArticle(id) {
    if (id === "new") return EditMode.renderCharacterEditor(null);
    const c = Store.getCharacter(id);
    if (!c) return `<p>Postava '${id}' nenalezena.</p>`;
    if (EditMode.isActive()) return EditMode.renderCharacterEditor(c);

    // ── View mode ────────────────────────────────────────────────
    const rels   = Store.getRelationships().filter(r => r.source === id || r.target === id);
    const chars  = Store.getCharacters();
    const events = Store.getEvents();

    const knownFacts = c.knowledge >= 2 && (c.known||[]).length ? `
      <div class="char-section">
        <div class="char-section-title">Co víme</div>
        <div class="fact-list">
          ${c.known.map(f => `<div class="fact-item">${f}</div>`).join("")}
        </div>
      </div>` : "";

    const unknownFacts = (c.unknown||[]).length ? `
      <div class="char-section">
        <div class="char-section-title">Otevřené Otázky</div>
        <div class="fact-list">
          ${c.unknown.map(f => `<div class="unknown-item">${f}</div>`).join("")}
        </div>
      </div>` : "";

    const relChips = rels.length ? `
      <div class="char-section">
        <div class="char-section-title">Vazby</div>
        <div class="relation-chips">
          ${rels.map(r => {
            const otherId = r.source === id ? r.target : r.source;
            const other   = chars.find(ch => ch.id === otherId);
            if (!other) return "";
            const dir = r.source === id ? "→" : "←";
            return `<a class="relation-chip" href="#/postava/${otherId}">
              <span>${other.name}</span>
              <span class="chip-label">${dir} ${r.label || relationLabel(r.type)}</span>
            </a>`;
          }).join("")}
        </div>
      </div>` : "";

    const eventsInvolved = events.filter(e => (e.characters||[]).includes(id));
    const eventList = eventsInvolved.length ? `
      <div class="char-section">
        <div class="char-section-title">Zmínky v Událostech</div>
        <div class="fact-list">
          ${eventsInvolved.map(e =>
            `<div class="fact-item"><a class="wiki-link" href="#/udalost/${e.id}">${e.name}</a> — ${e.short}</div>`
          ).join("")}
        </div>
      </div>` : "";

    // Profile chips: species/gender/age — only render if present and the
    // viewer knows enough about the character to see physical details.
    const profileBits = [];
    if (c.knowledge >= 2 && c.species) profileBits.push(`<span class="profile-chip">🧬 ${c.species}</span>`);
    if (c.knowledge >= 2 && c.gender)  profileBits.push(`<span class="profile-chip">⚥ ${c.gender}</span>`);
    if (c.knowledge >= 2 && c.age)     profileBits.push(`<span class="profile-chip">⌛ ${c.age}</span>`);
    const profileRow = profileBits.length
      ? `<div class="char-article-profile">${profileBits.join("")}</div>` : "";

    return `
      <button class="back-btn" onclick="history.back()">← Zpět</button>
      <div class="char-article">
        <div class="char-article-header">
          <div class="char-article-portrait-wrap">
            ${portraitWrap(c)}
          </div>
          <div class="char-article-meta">
            <div class="char-article-name">${c.knowledge >= 1 ? c.name : "Neznámá Postava"}</div>
            <div class="char-article-title-text">${c.knowledge >= 2 ? c.title : "—"}</div>
            <div class="char-article-badges">
              ${factionBadge(c.faction)}
              ${statusBadge(c.status)}
              ${knowledgeBadge(c.knowledge)}
            </div>
            ${profileRow}
            <div class="char-article-desc md-view">${c.knowledge >= 2 ? renderMarkdown(c.description) : "<em>O této postavě toho víme jen velmi málo.</em>"}</div>
          </div>
        </div>
        ${knownFacts}${unknownFacts}${relChips}${eventList}
      </div>
    `;
  }

  // ══════════════════════════════════════════════════════════════
  //  LOCATION LIST & ARTICLE
  // ══════════════════════════════════════════════════════════════
  function _mistaApply() {
    const s = _listState.mista;
    let locs = Store.getLocations();
    if (s.values && s.values.length) {
      locs = locs.filter(l => _matchAll(s.values,
        `${l.name||''} ${l.type||''} ${l.region||''} ${(l.tags||[]).join(' ')} ${l.description||''} ${l.status||''}`));
    }
    locs = [...locs];
    switch (s.sort) {
      case 'type':
        locs.sort((a, b) => _czCompare(a.type, b.type) || _czCompare(a.name, b.name));
        break;
      case 'status':
        locs.sort((a, b) => _czCompare(a.status, b.status) || _czCompare(a.name, b.name));
        break;
      case 'knowledge':
        locs.sort((a, b) =>
          (b.knowledge ?? 0) - (a.knowledge ?? 0) || _czCompare(a.name, b.name));
        break;
      case 'name':
      default:
        locs.sort((a, b) => _czCompare(a.name, b.name));
    }
    return locs;
  }

  function _mistaGridHtml() {
    const locs = _mistaApply();
    const newCard = EditMode.isActive() ? `
      <a class="loc-card loc-card-new" href="#/misto/new" style="text-decoration:none">
        <div class="loc-card-new-icon">＋</div>
        <div class="loc-card-new-label">Nové místo</div>
      </a>` : "";
    if (locs.length === 0) {
      return `<div class="list-empty">Žádné místo neodpovídá hledání.</div>${newCard}`;
    }
    return locs.map(l => {
      const pt = PIN_TYPES[l.pinType] || PIN_TYPES.custom || { icon: '📍', color: '#888' };
      const typeLabel = pt.label || l.type || '';
      const region = l.region ? `<div class="loc-card-sub">${esc(l.region)}</div>` : '';
      const editBtn = EditMode.isActive()
        ? `<span class="list-edit-btn" title="Upravit" style="position:absolute;top:0.4rem;right:0.4rem">✏</span>` : '';
      return `<a class="loc-card" href="#/misto/${l.id}" style="text-decoration:none;position:relative">
        ${editBtn}
        <div class="loc-card-icon" style="color:${pt.color}">${pt.icon}</div>
        <div class="loc-card-body">
          <div class="loc-card-name">${esc(l.name)}</div>
          <div class="loc-card-type">${esc(typeLabel)}</div>
          ${region}
        </div>
      </a>`;
    }).join("") + newCard;
  }

  function renderLocationList() {
    const total = Store.getLocations().length;
    const shown = _mistaApply().length;
    const newBtn = EditMode.isActive() ? `
      <a href="#/misto/new" class="list-item-new" style="text-decoration:none">＋ Nové místo</a>` : "";

    return `
      <div class="page-header" style="display:flex;align-items:center;gap:1rem">
        <div style="flex:1">
          <h1>Místa</h1>
          <div class="subtitle">${shown} / ${total} lokací</div>
        </div>
        ${newBtn}
      </div>
      ${_listToolbar('mista', [
        ['name',      'Jméno (A→Z)'],
        ['type',      'Typ'],
        ['status',    'Stav'],
        ['knowledge', 'Znalost (nejvíc)'],
      ])}
      <div class="loc-grid" id="wl-mista-grid">${_mistaGridHtml()}</div>
    `;
  }

  function setMistaSearch(v) {
    const arr = Array.isArray(v) ? v : (v ? [String(v)] : []);
    _listState.mista.values = arr;
    _persistListState();
    _refreshMistaGrid();
    _refreshMistaCount();
  }
  function setMistaSort(v) {
    _listState.mista.sort = v || 'name';
    _persistListState();
    _refreshMistaGrid();
  }
  function _refreshMistaGrid() {
    const host = document.getElementById('wl-mista-grid');
    if (host) host.innerHTML = _mistaGridHtml();
  }
  function _refreshMistaCount() {
    const sub = document.querySelector('.page-header .subtitle');
    if (!sub) return;
    const total = Store.getLocations().length;
    const shown = _mistaApply().length;
    sub.textContent = `${shown} / ${total} lokací`;
  }

  function renderLocationArticle(id) {
    if (id === "new") return EditMode.renderLocationEditor(null);
    const l = Store.getLocation(id);
    if (!l) return `<p>Místo '${id}' nenalezeno.</p>`;
    if (EditMode.isActive()) return EditMode.renderLocationEditor(l);

    const factions = Store.getFactions();
    const chars = Store.getCharactersInLocation(id).map(c =>
      `<a class="relation-chip" href="#/postava/${c.id}">${factions[c.faction]?.badge || "👤"} ${c.name}</a>`
    ).join("");

    // Hierarchy: ancestor breadcrumb + sub-locations.
    const ancestors = Store.getAncestorLocations(id).reverse();
    const breadcrumb = ancestors.length ? `
      <div class="location-breadcrumb">
        ${ancestors.map(a => `<a href="#/misto/${a.id}">📍 ${esc(a.name)}</a>`).join(' › ')}
        <span> › <strong>${esc(l.name)}</strong></span>
      </div>` : '';

    const subs = Store.getSubLocations(id);
    const subList = subs.length ? `
      <div class="char-section">
        <div class="char-section-title">Dílčí místa</div>
        <div class="relation-chips">
          ${subs.map(s => {
            const onMap = (typeof s.x === 'number' && typeof s.y === 'number');
            const dot = onMap ? '📍' : '·';
            return `<a class="relation-chip" href="#/misto/${s.id}">${dot} ${esc(s.name)}</a>`;
          }).join('')}
        </div>
      </div>` : '';

    // World-map / local-map entry points.
    const placed = (typeof l.x === 'number' && typeof l.y === 'number');
    const mapButtons = [];
    if (placed) {
      mapButtons.push(
        `<button class="inline-create-btn" onclick="WorldMap.showPin('${l.id}')">🧭 Najít na mapě</button>`
      );
    } else if (EditMode.isActive()) {
      mapButtons.push(
        `<button class="inline-create-btn" onclick="WorldMap.startPlacingPin('${l.id}')">📍 Umístit na mapu</button>`
      );
    }
    if (l.localMap) {
      mapButtons.push(
        `<a class="inline-create-btn" href="#/mapa/svet" onclick="setTimeout(()=>WorldMap.openLocalMap('${l.id}'),0)">🗺 Otevřít místní mapu</a>`
      );
    }
    const mapRow = mapButtons.length
      ? `<div class="inline-create-row">${mapButtons.join('')}</div>` : '';

    const inlineCreate = EditMode.isActive() ? `
      <div class="inline-create-row">
        <button class="inline-create-btn" onclick="EditMode.startNewCharacterInLocation('${l.id}')">＋ Postava zde</button>
        <button class="inline-create-btn" onclick="EditMode.startNewEvent({locations:['${l.id}']})">＋ Událost zde</button>
        <button class="inline-create-btn" onclick="EditMode.startNewLocation({parentId:'${l.id}'})">＋ Dílčí místo</button>
      </div>` : "";

    return `
      <button class="back-btn" onclick="history.back()">← Zpět</button>
      <div class="location-article">
        ${breadcrumb}
        <div class="page-header">
          <h1>📍 ${l.name}</h1>
          <div class="subtitle">${l.type || ''}${l.type && l.status ? ' · ' : ''}${l.status || ''}</div>
        </div>
        <div class="md-view">${renderMarkdown(l.description)}</div>
        ${l.notes ? `<div class="location-note md-view">${renderMarkdown(l.notes)}</div>` : ""}
        ${mapRow}
        ${subList}
        ${chars ? `<div class="char-section">
          <div class="char-section-title">Přítomné Postavy</div>
          <div class="relation-chips">${chars}</div>
        </div>` : ""}
        ${inlineCreate}
      </div>
    `;
  }

  // ══════════════════════════════════════════════════════════════
  //  EVENT ARTICLE (list view lives under /casova-osa)
  // ══════════════════════════════════════════════════════════════
  function renderEventArticle(id) {
    if (id === "new") return EditMode.renderEventEditor(null);
    const e = Store.getEvent(id);
    if (!e) return `<p>Událost '${id}' nenalezena.</p>`;
    if (EditMode.isActive()) return EditMode.renderEventEditor(e);

    const chars = (e.characters || []).map(cid => {
      const c = Store.getCharacter(cid);
      return c ? `<a class="relation-chip" href="#/postava/${cid}">${c.name}</a>` : "";
    }).join("");

    const locs = (e.locations || []).map(lid => {
      const l = Store.getLocation(lid);
      return l ? `<a class="relation-chip" href="#/misto/${lid}">📍 ${l.name}</a>` : "";
    }).join("");

    return `
      <button class="back-btn" onclick="history.back()">← Zpět</button>
      <div class="location-article">
        <div class="page-header">
          <h1>${e.name}</h1>
          <div class="subtitle">${e.sitting ? `Sezení ${e.sitting}` : 'Dávná minulost'}</div>
        </div>
        <div class="md-view">${renderMarkdown(e.description)}</div>
        ${chars ? `<div class="char-section"><div class="char-section-title">Zúčastněné Postavy</div><div class="relation-chips">${chars}</div></div>` : ""}
        ${locs  ? `<div class="char-section"><div class="char-section-title">Místa</div><div class="relation-chips">${locs}</div></div>` : ""}
      </div>
    `;
  }

  // ══════════════════════════════════════════════════════════════
  //  MYSTERIES LIST
  // ══════════════════════════════════════════════════════════════
  function renderMysteries() {
    const mysteries = Store.getMysteries();
    const sorted = [...mysteries].sort((a,b) => {
      const order = { kritická: 0, vysoká: 1, střední: 2 };
      return (order[a.priority] || 9) - (order[b.priority] || 9);
    });

    const newBtn = EditMode.isActive() ? `
      <a href="#/zahada/new" class="list-item-new" style="text-decoration:none">＋ Nová záhada</a>` : "";

    return `
      <div class="page-header" style="display:flex;align-items:center;gap:1rem">
        <div style="flex:1">
          <h1>❓ Záhady &amp; Otevřené Otázky</h1>
          <div class="subtitle">${mysteries.length} nevyřešených záhad</div>
        </div>
        ${newBtn}
      </div>
      <div class="mystery-list">
        ${sorted.map(m => {
          const editBtn = EditMode.isActive()
            ? `<a class="list-edit-btn" href="#/zahada/${m.id}" title="Upravit" style="float:right;margin-left:0.5rem">✏</a>` : "";
          return `<div class="mystery-card">
            <div class="mystery-name" style="display:flex;align-items:center;justify-content:space-between">
              <span>❓ ${m.name}</span>
              ${editBtn}
            </div>
            <div class="mystery-priority priority-${m.priority}">PRIORITA: ${m.priority.toUpperCase()}</div>
            <div class="mystery-desc md-view" style="margin-top:0.5rem">${renderMarkdown(m.description)}</div>
            ${(m.characters||[]).length ? `
              <div style="margin-top:0.75rem">
                <div class="char-section-title" style="font-size:0.7rem;margin-bottom:0.4rem">SPOJENÉ POSTAVY</div>
                <div class="relation-chips">
                  ${m.characters.map(cid => {
                    const c = Store.getCharacter(cid);
                    return c ? `<a class="relation-chip" href="#/postava/${cid}">${c.name}</a>` : "";
                  }).join("")}
                </div>
              </div>` : ""}
          </div>`;
        }).join("")}
      </div>
    `;
  }

  // ══════════════════════════════════════════════════════════════
  //  MYSTERY DETAIL / EDIT (route: #/zahada/{id})
  // ══════════════════════════════════════════════════════════════
  function renderMysteryArticle(id) {
    if (id === "new") return EditMode.renderMysteryEditor(null);
    const m = Store.getMystery(id);
    if (!m) return `<p>Záhada '${id}' nenalezena.</p>`;
    if (EditMode.isActive()) return EditMode.renderMysteryEditor(m);

    // View mode: expanded mystery card
    return `
      <button class="back-btn" onclick="history.back()">← Zpět</button>
      <div class="location-article">
        <div class="page-header">
          <h1>❓ ${m.name}</h1>
          <div class="subtitle mystery-priority priority-${m.priority}">PRIORITA: ${m.priority.toUpperCase()}</div>
        </div>
        <div class="md-view">${renderMarkdown(m.description)}</div>
        ${(m.characters||[]).length ? `
          <div class="char-section">
            <div class="char-section-title">Spojené Postavy</div>
            <div class="relation-chips">
              ${m.characters.map(cid => {
                const c = Store.getCharacter(cid);
                return c ? `<a class="relation-chip" href="#/postava/${cid}">${c.name}</a>` : "";
              }).join("")}
            </div>
          </div>` : ""}
        <div style="margin-top:1.5rem">
          <a href="#/zahady" class="wiki-link">← Zpět na seznam záhad</a>
        </div>
      </div>
    `;
  }

  // ══════════════════════════════════════════════════════════════
  //  FACTION LIST
  // ══════════════════════════════════════════════════════════════
  function _frakceApply() {
    const s = _listState.frakce;
    const factions = Store.getFactions();
    const chars    = Store.getCharacters();

    // Entries with pre-computed member count for sort "members" option.
    let entries = Object.entries(factions).map(([id, f]) => ({
      id, f,
      memberCount: chars.filter(c => c.faction === id).length,
    }));

    if (s.values && s.values.length) {
      entries = entries.filter(({ id, f }) =>
        _matchAll(s.values, `${id} ${f.name||''} ${f.description||''}`)
      );
    }

    switch (s.sort) {
      case 'name':
        entries.sort((a, b) => _czCompare(a.f.name, b.f.name));
        break;
      case 'members':
        entries.sort((a, b) =>
          b.memberCount - a.memberCount || _czCompare(a.f.name, b.f.name));
        break;
      case 'default':
      default:
        // Preserve insertion order from data.js / storage.
    }
    return entries;
  }

  function _frakceGridHtml() {
    const entries = _frakceApply();
    if (entries.length === 0) {
      return `<div class="list-empty">Žádná frakce neodpovídá hledání.</div>`;
    }
    return entries.map(({ id, f, memberCount }) => {
      const rankCount = (f.rankChains || []).reduce((s, ch) => s + ch.ranks.length, 0);
      const ovl = EditMode.isActive() ? editOverlay(`#/frakce/${id}`) : "";
      return `
        <a class="faction-card" href="#/frakce/${id}" style="text-decoration:none;position:relative;border-color:${f.color}55">
          ${ovl}
          <div class="faction-card-header" style="background:${f.color}22;border-bottom:1px solid ${f.color}33">
            <span class="faction-card-badge">${f.badge}</span>
            <span class="faction-card-name" style="color:${f.textColor}">${f.name}</span>
          </div>
          <div class="faction-card-meta">
            <span>👤 ${memberCount} postav</span>
            ${rankCount ? `<span>⚔ ${rankCount} hodností</span>` : ""}
          </div>
        </a>`;
    }).join("");
  }

  function renderFactionList() {
    const total = Object.keys(Store.getFactions()).length;
    const shown = _frakceApply().length;
    return `
      <div class="page-header" style="display:flex;align-items:center;gap:1rem">
        <div style="flex:1">
          <h1>⬡ Frakce</h1>
          <div class="subtitle">${shown} / ${total} frakcí</div>
        </div>
        ${EditMode.isActive() ? `<a href="#/frakce/new" class="list-item-new" style="text-decoration:none">＋ Nová frakce</a>` : ""}
      </div>
      ${_listToolbar('frakce', [
        ['default', 'Výchozí'],
        ['name',    'Jméno (A→Z)'],
        ['members', 'Počet postav'],
      ])}
      <div class="faction-grid" id="wl-frakce-grid">${_frakceGridHtml()}</div>
    `;
  }

  function setFrakceSearch(v) {
    const arr = Array.isArray(v) ? v : (v ? [String(v)] : []);
    _listState.frakce.values = arr;
    _persistListState();
    _refreshFrakceGrid();
    _refreshFrakceCount();
  }
  function setFrakceSort(v) {
    _listState.frakce.sort = v || 'default';
    _persistListState();
    _refreshFrakceGrid();
  }
  function _refreshFrakceGrid() {
    const host = document.getElementById('wl-frakce-grid');
    if (host) host.innerHTML = _frakceGridHtml();
  }
  function _refreshFrakceCount() {
    const sub = document.querySelector('.page-header .subtitle');
    if (!sub) return;
    const total = Object.keys(Store.getFactions()).length;
    const shown = _frakceApply().length;
    sub.textContent = `${shown} / ${total} frakcí`;
  }

  // ══════════════════════════════════════════════════════════════
  //  FACTION ARTICLE
  // ══════════════════════════════════════════════════════════════
  function renderFactionArticle(id) {
    if (id === "new") return EditMode.renderFactionEditor(null, "new");
    const factions = Store.getFactions();
    const f = factions[id];
    if (!f) return `<p>Frakce '${id}' nenalezena.</p>`;
    if (EditMode.isActive()) return EditMode.renderFactionEditor(f, id);

    const chars = Store.getCharacters().filter(c => c.faction === id);

    const _charChip = c => `<a class="relation-chip" href="#/postava/${c.id}">${esc(c.name)}</a>`;
    const chainSections = (f.rankChains || []).map(chain => {
      const chainMembers = chars.filter(c => c.rankChain === chain.id);
      const rows = chain.ranks.map(rank => ({
        label:   rank,
        members: chainMembers.filter(c => c.rank === rank).map(_charChip).join(''),
      }));
      const unrankedMembers = chainMembers.filter(c => !chain.ranks.includes(c.rank));
      const footer = unrankedMembers.length
        ? { label: 'Neznámá hodnost', members: unrankedMembers.map(_charChip).join('') }
        : null;
      return renderRankChain({
        title:     chain.name,
        color:     f.color,
        textColor: f.textColor,
        rows,
        footer,
      });
    }).join('');

    const unchained = chars.filter(c =>
      !c.rankChain || !(f.rankChains || []).find(ch => ch.id === c.rankChain)
    );

    const inlineCreate = EditMode.isActive() ? `
      <div class="inline-create-row">
        <button class="inline-create-btn" onclick="EditMode.startNewCharacter({faction:'${id}'})">＋ Nová postava ve frakci</button>
      </div>` : "";

    return `
      <button class="back-btn" onclick="history.back()">← Zpět</button>
      <div class="location-article">
        <div class="faction-article-header" style="border:1px solid ${f.color}44;background:${f.color}11">
          <span class="faction-article-badge">${f.badge}</span>
          <div>
            <h1 style="margin:0;color:${f.textColor}">${f.name}</h1>
            <div class="subtitle">${chars.length} postav</div>
          </div>
        </div>
        ${inlineCreate}
        ${f.description ? `<div class="md-view" style="margin-top:1rem">${renderMarkdown(f.description)}</div>` : ""}
        ${(f.rankChains || []).length ? `
          <div class="char-section" style="margin-top:1.5rem">
            <div class="char-section-title">Hodnostní Řetězce</div>
            ${chainSections}
          </div>` : ""}
        ${unchained.length ? `
          <div class="char-section">
            <div class="char-section-title">Členové</div>
            <div class="relation-chips">
              ${unchained.map(c => `<a class="relation-chip" href="#/postava/${c.id}">${c.name}</a>`).join("")}
            </div>
          </div>` : ""}
        <div style="margin-top:1.5rem">
          <a href="#/frakce" class="wiki-link">← Zpět na frakce</a>
        </div>
      </div>
    `;
  }

  // ══════════════════════════════════════════════════════════════
  //  RANK CHAIN — reusable themed hierarchy list
  //  Renders a card with a title strip and a series of numbered rows
  //  tinted to a single colour (faction color by default). Useful for
  //  rank chains, pantheon tiers, command hierarchies — anything where
  //  a short ordered list of buckets needs a themed wrapper.
  //
  //  Shape:
  //    renderRankChain({
  //      title:    "Dračí spáry",         // strip title
  //      color:    "#A0291C",             // accent base; derives all surfaces
  //      textColor:"#ffb6a8",             // optional — contrasted title text
  //      rows: [
  //        { label: "Velmistr", members: "<chips html>" },  // members = html
  //        { label: "Učeň",     members: "" }                // empty → "Nikdo"
  //      ],
  //      footer: { label: "Neznámá hodnost", members: "<chips>" } // optional
  //    })
  // ══════════════════════════════════════════════════════════════
  function renderRankChain({ title, color, textColor, rows, footer }) {
    const accent = color || '#C9A14B';
    const label  = textColor || accent;
    const rowsHtml = (rows || []).map((r, i) => `
      <div class="rank-row">
        <div class="rank-row-label">
          <span class="rank-dot">${i + 1}</span>
          <span class="rank-row-name">${esc(r.label)}</span>
        </div>
        <div class="rank-row-members">
          ${r.members && r.members.trim()
            ? r.members
            : `<span class="rank-row-empty">Nikdo</span>`}
        </div>
      </div>`).join('');
    const footerHtml = footer ? `
      <div class="rank-row rank-row-unranked">
        <div class="rank-row-label">
          <span class="rank-dot rank-dot-unknown">?</span>
          <span class="rank-row-name">${esc(footer.label)}</span>
        </div>
        <div class="rank-row-members">${footer.members || ''}</div>
      </div>` : '';
    return `
      <div class="rank-chain" style="--chain-color:${accent};--chain-text:${label}">
        <div class="rank-chain-title">${esc(title)}</div>
        ${rowsHtml}${footerHtml}
      </div>`;
  }

  // ══════════════════════════════════════════════════════════════
  //  SPECIES / PANTHEON / ARTIFACTS
  // ══════════════════════════════════════════════════════════════
  function _simpleListHeader(title, subtitle, newHref, newLabel) {
    const newBtn = EditMode.isActive() && newHref
      ? `<a href="${newHref}" class="list-item-new" style="text-decoration:none">＋ ${newLabel}</a>` : '';
    return `
      <div class="page-header" style="display:flex;align-items:center;gap:1rem">
        <div style="flex:1">
          <h1>${title}</h1>
          <div class="subtitle">${subtitle}</div>
        </div>
        ${newBtn}
      </div>`;
  }

  function _firstParagraph(md) {
    const txt = String(md || '').trim();
    if (!txt) return '';
    const line = txt.split(/\n\s*\n/)[0];
    return esc(line.length > 180 ? line.slice(0, 180) + '…' : line);
  }

  // ── Species (Druhy) ─────────────────────────────────────────────
  function renderSpeciesList() {
    const items = Store.getSpecies().slice()
      .sort((a, b) => _czCompare(a.name, b.name));
    const grid = items.length === 0
      ? `<div class="list-empty">Žádné druhy.</div>`
      : items.map(s => {
          const editBtn = EditMode.isActive()
            ? `<span class="list-edit-btn" title="Upravit" style="position:absolute;top:0.4rem;right:0.4rem">✏</span>` : '';
          return `<a class="loc-card" href="#/druh/${s.id}" style="text-decoration:none;position:relative">
            ${editBtn}
            <div class="loc-card-icon">🧬</div>
            <div class="loc-card-body">
              <div class="loc-card-name">${esc(s.name)}</div>
              <div class="loc-card-type">${_firstParagraph(s.description)}</div>
            </div>
          </a>`;
        }).join('');
    return `
      ${_simpleListHeader('🧬 Druhy', `${items.length} záznamů`, '#/druh/new', 'Nový druh')}
      <div class="loc-grid">${grid}</div>
    `;
  }

  function renderSpeciesArticle(id) {
    if (id === 'new') return EditMode.renderSpeciesEditor(null);
    const s = Store.getSpeciesItem(id);
    if (!s) return `<p>Druh '${id}' nenalezen.</p>`;
    if (EditMode.isActive()) return EditMode.renderSpeciesEditor(s);

    // Characters of this species.
    const chars = Store.getCharacters().filter(c =>
      c.species === id || c.species === s.name
    );
    const charChips = chars.length ? `
      <div class="char-section">
        <div class="char-section-title">Postavy tohoto druhu</div>
        <div class="relation-chips">
          ${chars.map(c => `<a class="relation-chip" href="#/postava/${c.id}">${esc(c.name)}</a>`).join('')}
        </div>
      </div>` : '';

    return `
      <button class="back-btn" onclick="history.back()">← Zpět</button>
      <div class="location-article">
        <div class="page-header">
          <h1>🧬 ${esc(s.name)}</h1>
        </div>
        <div class="md-view">${renderMarkdown(s.description)}</div>
        ${charChips}
      </div>
    `;
  }

  // ── Pantheon (Panteon) ──────────────────────────────────────────
  function renderPantheonList() {
    const items = Store.getPantheon().slice()
      .sort((a, b) => _czCompare(a.name, b.name));
    const grid = items.length === 0
      ? `<div class="list-empty">Žádná božstva.</div>`
      : items.map(g => {
          const editBtn = EditMode.isActive()
            ? `<span class="list-edit-btn" title="Upravit" style="position:absolute;top:0.4rem;right:0.4rem">✏</span>` : '';
          const sub = [g.domain, g.alignment].filter(Boolean).map(esc).join(' · ');
          return `<a class="loc-card" href="#/buh/${g.id}" style="text-decoration:none;position:relative">
            ${editBtn}
            <div class="loc-card-icon">${esc(g.symbol || '✨')}</div>
            <div class="loc-card-body">
              <div class="loc-card-name">${esc(g.name)}</div>
              <div class="loc-card-type">${sub}</div>
            </div>
          </a>`;
        }).join('');
    return `
      ${_simpleListHeader('✨ Panteon', `${items.length} božstev`, '#/buh/new', 'Nové božstvo')}
      <div class="loc-grid">${grid}</div>
    `;
  }

  function renderBuhArticle(id) {
    if (id === 'new') return EditMode.renderBuhEditor(null);
    const g = Store.getBuh(id);
    if (!g) return `<p>Božstvo '${id}' nenalezeno.</p>`;
    if (EditMode.isActive()) return EditMode.renderBuhEditor(g);

    const bits = [];
    if (g.domain)    bits.push(`<span class="profile-chip">🜲 ${esc(g.domain)}</span>`);
    if (g.alignment) bits.push(`<span class="profile-chip">⚖ ${esc(g.alignment)}</span>`);
    const profile = bits.length ? `<div class="char-article-profile">${bits.join('')}</div>` : '';

    return `
      <button class="back-btn" onclick="history.back()">← Zpět</button>
      <div class="location-article">
        <div class="page-header">
          <h1>${esc(g.symbol || '✨')} ${esc(g.name)}</h1>
        </div>
        ${profile}
        <div class="md-view">${renderMarkdown(g.description)}</div>
      </div>
    `;
  }

  // ── Artifacts (Artefakty) ───────────────────────────────────────
  function _artifactStateChip(stateId) {
    const st = Store.getArtifactStateMap()[stateId];
    if (!st) return '';
    return `<span class="badge" style="background:${st.color}22;color:${st.color};border:1px solid ${st.color}66">${st.icon} ${esc(st.label)}</span>`;
  }

  function renderArtifactList() {
    const items = Store.getArtifacts().slice()
      .sort((a, b) => _czCompare(a.name, b.name));
    const grid = items.length === 0
      ? `<div class="list-empty">Žádné artefakty.</div>`
      : items.map(a => {
          const editBtn = EditMode.isActive()
            ? `<span class="list-edit-btn" title="Upravit" style="position:absolute;top:0.4rem;right:0.4rem">✏</span>` : '';
          return `<a class="loc-card" href="#/artefakt/${a.id}" style="text-decoration:none;position:relative">
            ${editBtn}
            <div class="loc-card-icon">🗝</div>
            <div class="loc-card-body">
              <div class="loc-card-name">${esc(a.name)}</div>
              <div class="loc-card-type">${_artifactStateChip(a.state)}</div>
            </div>
          </a>`;
        }).join('');
    return `
      ${_simpleListHeader('🗝 Artefakty', `${items.length} artefaktů`, '#/artefakt/new', 'Nový artefakt')}
      <div class="loc-grid">${grid}</div>
    `;
  }

  function renderArtifactArticle(id) {
    if (id === 'new') return EditMode.renderArtifactEditor(null);
    const a = Store.getArtifact(id);
    if (!a) return `<p>Artefakt '${id}' nenalezen.</p>`;
    if (EditMode.isActive()) return EditMode.renderArtifactEditor(a);

    const owner = a.ownerCharacterId ? Store.getCharacter(a.ownerCharacterId) : null;
    const loc   = a.locationId       ? Store.getLocation(a.locationId)        : null;

    const links = [];
    if (owner) links.push(`<a class="relation-chip" href="#/postava/${owner.id}">🎒 ${esc(owner.name)}</a>`);
    if (loc)   links.push(`<a class="relation-chip" href="#/misto/${loc.id}">📍 ${esc(loc.name)}</a>`);
    const linksRow = links.length ? `
      <div class="char-section">
        <div class="char-section-title">Vazby</div>
        <div class="relation-chips">${links.join('')}</div>
      </div>` : '';

    return `
      <button class="back-btn" onclick="history.back()">← Zpět</button>
      <div class="location-article">
        <div class="page-header">
          <h1>🗝 ${esc(a.name)}</h1>
          <div class="subtitle">${_artifactStateChip(a.state)}</div>
        </div>
        <div class="md-view">${renderMarkdown(a.description)}</div>
        ${linksRow}
      </div>
    `;
  }

  // ── Public API ─────────────────────────────────────────────────
  function renderPage(page, param) {
    const el = document.getElementById("main-content");
    if (!el) return;

    let html = "";
    switch (page) {
      case "dashboard":  html = renderDashboard(); break;
      case "postavy":    html = renderCharacterList(param); break;
      case "postava":    html = renderCharacterArticle(param); break;
      case "mista":      html = renderLocationList(); break;
      case "misto":      html = renderLocationArticle(param); break;
      case "udalost":    html = renderEventArticle(param); break;
      case "zahady":     html = renderMysteries(); break;
      case "zahada":     html = renderMysteryArticle(param); break;
      case "frakce":     html = renderFactionList(); break;
      case "frakce-id":  html = renderFactionArticle(param); break;
      case "druhy":      html = renderSpeciesList(); break;
      case "druh":       html = renderSpeciesArticle(param); break;
      case "panteon":    html = renderPantheonList(); break;
      case "buh":        html = renderBuhArticle(param); break;
      case "artefakty":  html = renderArtifactList(); break;
      case "artefakt":   html = renderArtifactArticle(param); break;
      default:           html = renderDashboard();
    }
    el.innerHTML = html;
    el.scrollTop = 0;
    window.scrollTo(0, 0);
  }

  return {
    renderPage,
    renderRankChain,
    setPostavySearch, setPostavySort,
    setMistaSearch,   setMistaSort,
    setFrakceSearch,  setFrakceSort,
  };
})();

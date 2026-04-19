// ═══════════════════════════════════════════════════════════════
//  ADMIN PANEL — full CRUD for all campaign data
//  Accessed via #/admin route.
//  Saves to Store (localStorage); mind maps auto-pick up changes.
// ═══════════════════════════════════════════════════════════════

import { Store } from './store.js';

export const Admin = (() => {

  let _tab    = 'characters';
  let _editId = null;   // id of entity being edited (null = new)

  const REL_TYPES = [
    { id: 'commands',    label: 'Velí',           color: '#8B0000' },
    { id: 'ally',        label: 'Spojenec',        color: '#2E7D32' },
    { id: 'enemy',       label: 'Nepřítel',        color: '#C62828' },
    { id: 'mission',     label: 'Mise / Úkol',     color: '#E65100' },
    { id: 'mystery',     label: 'Záhada / Tajná',  color: '#6A1B9A' },
    { id: 'captured_by', label: 'Zajat/a',         color: '#0D47A1' },
    { id: 'history',     label: 'Historie',        color: '#555555' },
    { id: 'uncertain',   label: 'Nejasná',         color: '#757575' },
    { id: 'negotiates',  label: 'Vyjednává',       color: '#1565C0' },
  ];

  const PRIORITIES = ['kritická', 'vysoká', 'střední', 'nízká'];

  // ── Helpers ─────────────────────────────────────────────────
  function _el(id) { return document.getElementById(id); }

  function _val(id) {
    const el = _el(id);
    return el ? el.value.trim() : '';
  }

  function _toast(msg, ok = true) {
    let t = _el('admin-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'admin-toast';
      t.className = 'admin-toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.className = 'admin-toast ' + (ok ? 'ok' : 'err') + ' visible';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('visible'), 2400);
  }

  function _listValues(wrapperId) {
    return Array.from(
      document.querySelectorAll(`#${wrapperId} .dyn-item-input`)
    ).map(i => i.value.trim()).filter(Boolean);
  }

  function _charOptions(selectedId = '') {
    return Store.getCharacters()
      .sort((a,b) => a.name.localeCompare(b.name, 'cs'))
      .map(c => `<option value="${c.id}" ${c.id === selectedId ? 'selected' : ''}>${c.name}</option>`)
      .join('');
  }

  function _locOptions(selectedId = '') {
    return Store.getLocations()
      .map(l => `<option value="${l.id}" ${l.id === selectedId ? 'selected' : ''}>${l.name}</option>`)
      .join('');
  }

  // ── Rank chain field ─────────────────────────────────────────
  function _rankChainField(c) {
    const factionId = c?.faction || 'neutral';
    const faction   = Store.getFactions()[factionId] || {};
    const chains    = faction.rankChains || [];
    if (!chains.length) return '<div class="admin-field" style="opacity:0.4"><span class="admin-label">Hodnost</span><span style="font-size:12px">— Frakce nemá hodnosti —</span></div>';

    const chainOpts = chains.map(ch =>
      `<option value="${_esc(ch.id)}" ${c?.rankChain===ch.id?'selected':''}>${_esc(ch.name)}</option>`
    ).join('');

    // Rank options for currently selected chain (or first chain)
    const selChain  = chains.find(ch => ch.id === c?.rankChain) || chains[0];
    const rankOpts  = (selChain?.ranks || []).map(r =>
      `<option value="${_esc(r)}" ${c?.rank===r?'selected':''}>${_esc(r)}</option>`
    ).join('');

    return `
      <div class="admin-field">
        <label class="admin-label">Řetěz hodností</label>
        <select class="admin-input" id="f-rank-chain" onchange="Admin.updateRankOpts()">${chainOpts}</select>
      </div>
      <div class="admin-field">
        <label class="admin-label">Hodnost</label>
        <select class="admin-input" id="f-rank"><option value="">— žádná —</option>${rankOpts}</select>
      </div>`;
  }

  // ── Location roles widget ────────────────────────────────────
  function _locationRolesWidget(roles) {
    const locMap = {};
    Store.getLocations().forEach(l => { locMap[l.id] = l.name; });
    const locOpts = `<option value="">— místo —</option>` +
      Store.getLocations().map(l => `<option value="${l.id}">${_esc(l.name)}</option>`).join('');

    const rows = (roles || []).map((r, i) => `
      <div class="dyn-item loc-role-row" data-idx="${i}">
        <select class="admin-input loc-role-loc" style="flex:1.2">
          ${Store.getLocations().map(l =>
            `<option value="${l.id}" ${r.locationId===l.id?'selected':''}>${_esc(l.name)}</option>`
          ).join('')}
        </select>
        <input class="admin-input loc-role-txt" style="flex:2" type="text" value="${_esc(r.role||'')}" placeholder="Role (Starosta, Vězeň...)">
        <button type="button" class="admin-icon-btn" onclick="this.parentElement.remove()">✕</button>
      </div>`).join('');

    return `
      <div class="dyn-list" id="loc-roles-list">
        ${rows}
        <button type="button" class="admin-btn-sm" onclick="Admin.addLocRole()">+ Přidat roli</button>
      </div>`;
  }

  function addLocRole() {
    const list = document.getElementById('loc-roles-list');
    const btn  = list.querySelector('button[onclick*="addLocRole"]');
    const locOpts = Store.getLocations().map(l =>
      `<option value="${l.id}">${_esc(l.name)}</option>`
    ).join('');
    const row = document.createElement('div');
    row.className = 'dyn-item loc-role-row';
    row.innerHTML = `
      <select class="admin-input loc-role-loc" style="flex:1.2">
        <option value="">— místo —</option>${locOpts}
      </select>
      <input class="admin-input loc-role-txt" style="flex:2" type="text" value="" placeholder="Role (Starosta, Vězeň...)">
      <button type="button" class="admin-icon-btn" onclick="this.parentElement.remove()">✕</button>`;
    list.insertBefore(row, btn);
  }

  function _multiSelect(allItems, selectedIds, key, labelKey) {
    return allItems.map(item => {
      const checked = selectedIds.includes(item[key]);
      return `<label class="admin-check">
        <input type="checkbox" value="${item[key]}" ${checked ? 'checked' : ''}> ${item[labelKey]}
      </label>`;
    }).join('');
  }

  function _dynamicList(items, wrapperId) {
    const rows = items.map((v, i) => _dynRow(wrapperId, v)).join('');
    return `
      <div class="dyn-list" id="${wrapperId}">
        ${rows}
        <button type="button" class="admin-btn-sm" onclick="Admin.addDynRow('${wrapperId}')">+ Přidat</button>
      </div>`;
  }

  function _dynRow(wrapperId, value = '') {
    return `<div class="dyn-item">
      <input class="admin-input dyn-item-input" type="text" value="${_esc(value)}">
      <button type="button" class="admin-icon-btn" onclick="this.parentElement.remove()">✕</button>
    </div>`;
  }

  function _esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function addDynRow(wrapperId) {
    const wrap = _el(wrapperId);
    if (!wrap) return;
    const btn = wrap.querySelector('button');
    const row = document.createElement('div');
    row.innerHTML = _dynRow(wrapperId);
    wrap.insertBefore(row.firstElementChild, btn);
  }

  // ── Shell ────────────────────────────────────────────────────
  function render() {
    const el = _el('main-content');
    el.innerHTML = `
      <div class="admin-shell">
        <div class="admin-topbar">
          <div class="admin-logo">⚙ Admin — O Barvách Draků</div>
          <div class="admin-topbar-right">
            <button class="admin-btn-sm ok" onclick="Admin.backupJSON()" title="Stáhne zálohu všech dat jako JSON soubor">📥 Záloha JSON</button>
            <label class="admin-btn-sm" title="Obnov data ze zálohy JSON" style="cursor:pointer">
              📤 Obnovit
              <input type="file" accept=".json,application/json" style="display:none" onchange="Admin.restoreJSON(this)">
            </label>
            <button class="admin-btn-sm" onclick="Admin.migratePortraits()" title="Přesune portréty z web/portraits/ do správné adresářové struktury a aktualizuje data">🖼 Migrovat portréty</button>
            <button class="admin-btn-sm" onclick="Admin.exportData()">💾 Export JS</button>
            <button class="admin-btn-sm err" onclick="Admin.confirmReset()">↺ Reset</button>
            <a href="#/" class="admin-btn-sm">← Zpět do Kodexu</a>
          </div>
        </div>

        <div class="admin-tabs">
          ${['characters','relationships','locations','events','mysteries','factions'].map(t => `
            <button class="admin-tab ${_tab===t?'active':''}" onclick="Admin.switchTab('${t}')">
              ${{characters:'👤 Postavy', relationships:'🕸 Vazby', locations:'📍 Místa', events:'📜 Události', mysteries:'❓ Záhady', factions:'⬡ Frakce'}[t]}
            </button>
          `).join('')}
        </div>

        <div class="admin-body">
          <div class="admin-list-panel" id="admin-list-panel"></div>
          <div class="admin-editor-panel" id="admin-editor-panel">
            <div class="admin-placeholder">← Vyberte záznam nebo klikněte na „+ Nový"</div>
          </div>
        </div>
      </div>
    `;
    _renderList();
  }

  function switchTab(tab) {
    _tab = tab;
    _editId = null;
    render();
  }

  // ── List panels ──────────────────────────────────────────────
  function _renderList() {
    const el = _el('admin-list-panel');
    if (!el) return;
    switch (_tab) {
      case 'characters':    el.innerHTML = _charList();      break;
      case 'relationships': el.innerHTML = _relList();       break;
      case 'locations':     el.innerHTML = _locList();       break;
      case 'events':        el.innerHTML = _eventList();     break;
      case 'mysteries':     el.innerHTML = _mystList();      break;
      case 'factions':      el.innerHTML = _factionList();   break;
    }
  }

  function _charList() {
    const chars = Store.getCharacters()
      .sort((a,b) => a.name.localeCompare(b.name, 'cs'));
    return `
      <div class="admin-list-header">
        <span>${chars.length} postav</span>
        <button class="admin-btn-sm ok" onclick="Admin.editCharacter(null)">+ Nová</button>
      </div>
      <div class="admin-list-items">
        ${chars.map(c => `
          <div class="admin-list-item ${_editId===c.id?'active':''}" onclick="Admin.editCharacter('${c.id}')">
            <div class="ali-portrait">
              ${c.portrait
                ? `<img src="${c.portrait}" alt="">`
                : `<span>${(Store.getFactions()[c.faction]||{}).badge||'👤'}</span>`}
            </div>
            <div class="ali-info">
              <div class="ali-name">${c.name}</div>
              <div class="ali-sub">${c.title||''}</div>
            </div>
            <div class="ali-badges">
              <span class="admin-pill" style="background:${(Store.getFactions()[c.faction]||{}).color||'#444'}22;color:${(Store.getFactions()[c.faction]||{}).color||'#888'}">${c.faction}</span>
              <span class="admin-pill ${c.status}">${c.status}</span>
            </div>
          </div>
        `).join('')}
      </div>`;
  }

  function _relList() {
    const rels = Store.getRelationships();
    const chars = Store.getCharacters();
    const name = id => {
      const c = chars.find(c => c.id === id);
      return c ? c.name : id;
    };
    return `
      <div class="admin-list-header">
        <span>${rels.length} vazeb</span>
        <button class="admin-btn-sm ok" onclick="Admin.editRelationship(null)">+ Nová</button>
      </div>
      <div class="admin-list-items">
        ${rels.map((r, i) => {
          const rt = REL_TYPES.find(t => t.id === r.type) || {color:'#888', label: r.type};
          return `
            <div class="admin-list-item rel-item" onclick="Admin.editRelationship(${i})">
              <div class="ali-info">
                <div class="ali-name"><span style="color:#ccc">${name(r.source)}</span>
                  <span style="color:${rt.color};margin:0 4px">→</span>
                  <span style="color:#ccc">${name(r.target)}</span></div>
                <div class="ali-sub" style="color:${rt.color}">${rt.label}${r.label?' — '+r.label:''}</div>
              </div>
              <button class="admin-icon-btn err" onclick="event.stopPropagation();Admin.deleteRelByIndex(${i})">✕</button>
            </div>`;
        }).join('')}
      </div>`;
  }

  function _locList() {
    return `
      <div class="admin-list-header">
        <span>${Store.getLocations().length} míst</span>
        <button class="admin-btn-sm ok" onclick="Admin.editLocation(null)">+ Nové</button>
      </div>
      <div class="admin-list-items">
        ${Store.getLocations().map(l => `
          <div class="admin-list-item ${_editId===l.id?'active':''}" onclick="Admin.editLocation('${l.id}')">
            <div class="ali-info">
              <div class="ali-name">📍 ${l.name}</div>
              <div class="ali-sub">${l.type} · ${l.status}</div>
            </div>
          </div>`).join('')}
      </div>`;
  }

  function _eventList() {
    return `
      <div class="admin-list-header">
        <span>${Store.getEvents().length} událostí</span>
        <button class="admin-btn-sm ok" onclick="Admin.editEvent(null)">+ Nová</button>
      </div>
      <div class="admin-list-items">
        ${[...Store.getEvents()].sort((a,b) => {
          const sA = a.sitting ?? 0, sB = b.sitting ?? 0;
          if (sA !== sB) return sA - sB;
          return (a.order ?? 0) - (b.order ?? 0);
        }).map(e => `
          <div class="admin-list-item ${_editId===e.id?'active':''}" onclick="Admin.editEvent('${e.id}')">
            <div class="ali-info">
              <div class="ali-name">${e.sitting ? `S${e.sitting}` : '✦'} ${e.name}</div>
              <div class="ali-sub">${e.short||''}</div>
            </div>
          </div>`).join('')}
      </div>`;
  }

  function _mystList() {
    return `
      <div class="admin-list-header">
        <span>${Store.getMysteries().length} záhad</span>
        <button class="admin-btn-sm ok" onclick="Admin.editMystery(null)">+ Nová</button>
      </div>
      <div class="admin-list-items">
        ${Store.getMysteries().map(m => `
          <div class="admin-list-item ${_editId===m.id?'active':''}" onclick="Admin.editMystery('${m.id}')">
            <div class="ali-info">
              <div class="ali-name">❓ ${m.name}</div>
              <div class="ali-sub priority-${m.priority}">${m.priority||''}</div>
            </div>
          </div>`).join('')}
      </div>`;
  }

  // ── Character Editor ────────────────────────────────────────
  function editCharacter(id) {
    _editId = id;
    _renderList();
    const el = _el('admin-editor-panel');
    const c = id ? Store.getCharacter(id) : null;

    const factionOpts = Object.entries(Store.getFactions()).map(([fid, f]) =>
      `<option value="${fid}" ${(c?.faction||'neutral')===fid?'selected':''}>${f.badge} ${f.name}</option>`
    ).join('');

    const statusOpts = Object.entries(Store.getStatusMap()).map(([sid, s]) =>
      `<option value="${sid}" ${(c?.status||'alive')===sid?'selected':''}>${s.icon} ${s.label}</option>`
    ).join('');

    const locOpts = `<option value="">— žádné —</option>` +
      Store.getLocations().map(l =>
        `<option value="${l.id}" ${c?.location===l.id?'selected':''}>${l.name}</option>`
      ).join('');

    el.innerHTML = `
      <div class="admin-form">
        <div class="admin-form-title">${id ? 'Upravit: ' + (c?.name||'?') : 'Nová Postava'}</div>

        <div class="admin-portrait-section">
          <div class="admin-portrait-preview" id="portrait-preview-wrap" onclick="_el('portrait-file-input').click()" style="cursor:pointer;title:'Klikni pro upload'">
            ${c?.portrait
              ? `<img src="${c.portrait}" id="portrait-preview-img" alt="Portrét">`
              : `<div class="portrait-placeholder-admin" id="portrait-preview-img">👤</div>`}
            <div class="portrait-upload-hint">📷 Klik pro upload</div>
          </div>
          <input type="file" id="portrait-file-input" accept="image/*,image/png,image/jpeg,image/webp" style="display:none" onchange="Admin.handlePortraitUpload(this)">
          <input type="hidden" id="portrait-data" value="${_esc(c?.portrait||'')}">
          <button type="button" class="admin-btn-sm err" style="margin-top:0.4rem" onclick="Admin.clearPortrait()">✕ Smazat portrét</button>
        </div>

        <div class="admin-field">
          <label class="admin-label">Jméno *</label>
          <input class="admin-input" id="f-name" type="text" value="${_esc(c?.name||'')}" placeholder="Jméno postavy">
        </div>
        <div class="admin-field">
          <label class="admin-label">ID (unikátní, bez mezer)</label>
          <input class="admin-input" id="f-id" type="text" value="${_esc(c?.id||'')}" placeholder="auto z jména"
            ${id ? 'readonly style="opacity:0.5"' : ''}>
        </div>
        <div class="admin-field">
          <label class="admin-label">Titul / Funkce</label>
          <input class="admin-input" id="f-title" type="text" value="${_esc(c?.title||'')}" placeholder="Velitelka, Obchodník...">
        </div>
        <div class="admin-row">
          <div class="admin-field">
            <label class="admin-label">Frakce</label>
            <select class="admin-input" id="f-faction" onchange="Admin.updateRankOpts()">${factionOpts}</select>
          </div>
          <div class="admin-field">
            <label class="admin-label">Status</label>
            <select class="admin-input" id="f-status">${statusOpts}</select>
          </div>
        </div>
        <div class="admin-row" id="rank-row">
          ${_rankChainField(c)}
        </div>
        <div class="admin-field">
          <label class="admin-label">Úroveň znalosti: <span id="know-val">${c?.knowledge??2}</span></label>
          <input class="admin-range" id="f-knowledge" type="range" min="0" max="4" value="${c?.knowledge??2}"
            oninput="_el('know-val').textContent=this.value">
          <div class="know-labels"><span>Neznámý</span><span>Tušený</span><span>Základní</span><span>Dobře znám</span><span>Plně</span></div>
        </div>
        <div class="admin-field">
          <label class="admin-label">Lokace</label>
          <select class="admin-input" id="f-location">${locOpts}</select>
        </div>
        <div class="admin-field">
          <label class="admin-label">Popis</label>
          <textarea class="admin-input" id="f-description" rows="4" placeholder="Krátký popis postavy...">${_esc(c?.description||'')}</textarea>
        </div>
        <div class="admin-field">
          <label class="admin-label">Co víme (ověřené fakty)</label>
          ${_dynamicList(c?.known||[], 'list-known')}
        </div>
        <div class="admin-field">
          <label class="admin-label">Otevřené otázky</label>
          ${_dynamicList(c?.unknown||[], 'list-unknown')}
        </div>
        <div class="admin-field">
          <label class="admin-label">Tagy (čárkou oddělené)</label>
          <input class="admin-input" id="f-tags" type="text" value="${_esc((c?.tags||[]).join(', '))}" placeholder="antagonista, velitel...">
        </div>
        <div class="admin-field">
          <label class="admin-label">Role na místech <span style="font-weight:400;opacity:0.7">(Starosta Greenest, Velitel tábora…)</span></label>
          ${_locationRolesWidget(c?.locationRoles||[])}
        </div>

        <div class="admin-actions">
          <button class="admin-btn ok" onclick="Admin.saveCharacter()">💾 Uložit</button>
          ${id ? `<button class="admin-btn err" onclick="Admin.deleteCharacter('${id}')">🗑 Smazat</button>` : ''}
        </div>
      </div>`;

    // Auto-fill ID from name when creating new
    if (!id) {
      _el('f-name').addEventListener('input', e => {
        _el('f-id').value = Store.generateId(e.target.value);
      });
    }
  }

  async function handlePortraitUpload(input) {
    const file = input.files[0];
    if (!file) return;
    try {
      _toast('Nahrávám obrázek…');
      // Use the character's ID for per-character storage when editing an existing character.
      // For new characters (_editId is null) use _new as a temp subfolder; the server
      // migrates _new/ → {charId}/ automatically when the character is saved.
      const url       = await Store.uploadPortrait(file, _editId || '_new');
      const bustedUrl = url + '?v=' + Date.now();
      _el('portrait-data').value = bustedUrl;
      const prev = _el('portrait-preview-img');
      if (prev && prev.tagName === 'IMG') {
        prev.src = bustedUrl;
      } else if (prev) {
        const img = document.createElement('img');
        img.id = 'portrait-preview-img';
        img.src = bustedUrl;
        img.alt = 'Portrét';
        prev.replaceWith(img);
      }
      _toast('Obrázek nahrán ✓');
    } catch(e) {
      _toast('Chyba při nahrávání obrázku', false);
      console.error(e);
    }
  }

  // Rebuild rank dropdown when faction or chain changes
  function updateRankOpts() {
    const factionId = _val('f-faction');
    const faction   = Store.getFactions()[factionId] || {};
    const chains    = faction.rankChains || [];
    const rankRow   = document.getElementById('rank-row');
    if (!rankRow) return;

    if (!chains.length) {
      rankRow.innerHTML = '<div class="admin-field" style="opacity:0.4"><span class="admin-label">Hodnost</span><span style="font-size:12px">— Frakce nemá hodnosti —</span></div>';
      return;
    }
    const selChainId = _val('f-rank-chain') || chains[0].id;
    const chainOpts  = chains.map(ch =>
      `<option value="${_esc(ch.id)}" ${ch.id===selChainId?'selected':''}>${_esc(ch.name)}</option>`
    ).join('');
    const selChain  = chains.find(ch => ch.id === selChainId) || chains[0];
    const rankOpts  = (selChain?.ranks || []).map(r =>
      `<option value="${_esc(r)}">${_esc(r)}</option>`
    ).join('');
    rankRow.innerHTML = `
      <div class="admin-field">
        <label class="admin-label">Řetěz hodností</label>
        <select class="admin-input" id="f-rank-chain" onchange="Admin.updateRankOpts()">${chainOpts}</select>
      </div>
      <div class="admin-field">
        <label class="admin-label">Hodnost</label>
        <select class="admin-input" id="f-rank"><option value="">— žádná —</option>${rankOpts}</select>
      </div>`;
  }

  function clearPortrait() {
    _el('portrait-data').value = '';
    const prev = _el('portrait-preview-img');
    if (prev) {
      const ph = document.createElement('div');
      ph.id = 'portrait-preview-img';
      ph.className = 'portrait-placeholder-admin';
      ph.textContent = '👤';
      prev.replaceWith(ph);
    }
  }

  function saveCharacter() {
    const name = _val('f-name');
    if (!name) { _toast('Jméno je povinné!', false); return; }

    let id = _val('f-id') || Store.generateId(name);
    if (!id) id = 'postava_' + Date.now();

    // Collect location roles
    const locRoles = [];
    document.querySelectorAll('.loc-role-row').forEach(row => {
      const locId = row.querySelector('.loc-role-loc')?.value;
      const role  = row.querySelector('.loc-role-txt')?.value.trim();
      if (locId && role) locRoles.push({ locationId: locId, role });
    });

    const char = {
      id,
      name,
      title:         _val('f-title'),
      faction:       _val('f-faction') || 'neutral',
      status:        _val('f-status')  || 'unknown',
      knowledge:     parseInt(_val('f-knowledge') || '2'),
      rankChain:     _val('f-rank-chain') || null,
      rank:          _val('f-rank')       || null,
      location:      _val('f-location') || null,
      description:   _val('f-description'),
      portrait:      _val('portrait-data') || null,
      known:         _listValues('list-known'),
      unknown:       _listValues('list-unknown'),
      tags:          _val('f-tags').split(',').map(t=>t.trim()).filter(Boolean),
      locationRoles: locRoles,
    };

    // If the portrait moved to a genuinely different subfolder, delete the old one.
    // Strip ?v= cache-busters and compare subfolder segments only (PNG→JPG in the
    // same charId subfolder is handled server-side during upload, not here).
    const oldChar      = _editId ? Store.getCharacter(_editId) : null;
    const oldPortrait  = (oldChar?.portrait || '').split('?')[0];
    const newPortrait  = (char.portrait     || '').split('?')[0];
    char.portrait      = newPortrait || null;
    if (oldPortrait && oldPortrait !== newPortrait && oldPortrait.startsWith('/portraits/')) {
      const oldSeg = oldPortrait.replace('/portraits/', '').split('/')[0];
      const newSeg = newPortrait.replace('/portraits/', '').split('/')[0];
      if (oldSeg !== newSeg) Store.deletePortrait(oldPortrait);
    }

    const ok = Store.saveCharacter(char);
    _editId = char.id;
    if (ok === false) {
      _toast('⚠ Uložení selhalo – úložiště je plné. Zkus zmenšit portrét.', false);
    } else {
      _toast(`${char.name} uložen/a ✓`);
    }
    _renderList();
  }

  function deleteCharacter(id) {
    const c = Store.getCharacter(id);
    if (!c) return;
    if (!confirm(`Smazat postavu „${c.name}" a všechny její vazby?`)) return;
    Store.deleteCharacter(id);
    _editId = null;
    _el('admin-editor-panel').innerHTML = '<div class="admin-placeholder">← Postava smazána.</div>';
    _renderList();
    _toast('Postava smazána.');
  }

  // ── Relationship Editor ─────────────────────────────────────
  function editRelationship(idx) {
    _editId = idx;
    _renderList();
    const el = _el('admin-editor-panel');
    const rels = Store.getRelationships();
    const existing = idx !== null ? rels[idx] : null;

    const rtOpts = REL_TYPES.map(t =>
      `<option value="${t.id}" ${existing?.type===t.id?'selected':''}>${t.label}</option>`
    ).join('');

    el.innerHTML = `
      <div class="admin-form">
        <div class="admin-form-title">${idx !== null ? 'Upravit Vazbu' : 'Nová Vazba'}</div>
        <p class="admin-hint">Nové vazby se automaticky zobrazí ve všech mind mapách při příštím otevření.</p>

        <div class="admin-field">
          <label class="admin-label">Zdroj (kdo)</label>
          <select class="admin-input" id="f-rel-source">
            <option value="">— vyberte —</option>
            ${_charOptions(existing?.source)}
          </select>
        </div>
        <div class="admin-field">
          <label class="admin-label">Typ vazby</label>
          <select class="admin-input" id="f-rel-type" onchange="Admin.updateRelPreview()">
            ${rtOpts}
          </select>
        </div>
        <div class="admin-field">
          <label class="admin-label">Cíl (koho)</label>
          <select class="admin-input" id="f-rel-target">
            <option value="">— vyberte —</option>
            ${_charOptions(existing?.target)}
          </select>
        </div>
        <div class="admin-field">
          <label class="admin-label">Popis vazby (volitelný)</label>
          <input class="admin-input" id="f-rel-label" type="text" value="${_esc(existing?.label||'')}" placeholder="např. mučila, pomohl ukrýt sošku...">
        </div>

        <div class="rel-preview" id="rel-preview"></div>

        <div class="admin-actions">
          <button class="admin-btn ok" onclick="Admin.saveRelationship(${idx !== null ? idx : 'null'})">💾 Uložit Vazbu</button>
          ${idx !== null ? `<button class="admin-btn err" onclick="Admin.deleteRelByIndex(${idx})">🗑 Smazat</button>` : ''}
        </div>
      </div>`;

    updateRelPreview();
  }

  function updateRelPreview() {
    const src  = _val('f-rel-source');
    const type = _val('f-rel-type');
    const tgt  = _val('f-rel-target');
    const lbl  = _val('f-rel-label');
    const prev = _el('rel-preview');
    if (!prev) return;

    const rt = REL_TYPES.find(t => t.id === type) || {color:'#888', label:type};
    const srcName = Store.getCharacter(src)?.name || src || '?';
    const tgtName = Store.getCharacter(tgt)?.name || tgt || '?';
    prev.innerHTML = `
      <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap">
        <span class="rel-node">${srcName}</span>
        <span style="color:${rt.color};font-size:0.85rem">—— ${rt.label}${lbl?' ('+lbl+')':''} ——→</span>
        <span class="rel-node">${tgtName}</span>
      </div>`;
  }

  function saveRelationship(existingIdx) {
    const source = _val('f-rel-source');
    const target = _val('f-rel-target');
    const type   = _val('f-rel-type');
    if (!source || !target) { _toast('Vyberte zdroj i cíl!', false); return; }
    if (source === target)  { _toast('Zdroj a cíl nemůžou být stejná postava!', false); return; }

    const rel = { source, target, type, label: _val('f-rel-label') };

    if (existingIdx !== null) {
      // Update in place
      const rels = Store.getRelationships();
      rels[existingIdx] = rel;
      Store.saveRelationship(rel);
    } else {
      Store.saveRelationship(rel);
    }
    _toast('Vazba uložena ✓ — zobrazí se na mapách.');
    _editId = null;
    _renderList();
    _el('admin-editor-panel').innerHTML = '<div class="admin-placeholder">Vazba uložena. Vyberte další nebo přidejte novou.</div>';
  }

  function deleteRelByIndex(idx) {
    if (!confirm('Smazat tuto vazbu?')) return;
    const rels = Store.getRelationships();
    const r = rels[idx];
    if (r) Store.deleteRelationship(r.source, r.target, r.type);
    _editId = null;
    _renderList();
    _el('admin-editor-panel').innerHTML = '<div class="admin-placeholder">Vazba smazána.</div>';
    _toast('Vazba smazána.');
  }

  // ── Location Editor ─────────────────────────────────────────
  function editLocation(id) {
    _editId = id;
    _renderList();
    const el = _el('admin-editor-panel');
    const l = id ? Store.getLocation(id) : null;
    const allChars = Store.getCharacters();
    const allLocs  = Store.getLocations();

    el.innerHTML = `
      <div class="admin-form">
        <div class="admin-form-title">${id ? 'Upravit: ' + l?.name : 'Nové Místo'}</div>

        <div class="admin-row">
          <div class="admin-field">
            <label class="admin-label">Název *</label>
            <input class="admin-input" id="f-loc-name" type="text" value="${_esc(l?.name||'')}" placeholder="Greenest...">
          </div>
          <div class="admin-field">
            <label class="admin-label">ID</label>
            <input class="admin-input" id="f-loc-id" type="text" value="${_esc(l?.id||'')}"
              ${id?'readonly style="opacity:0.5"':''} placeholder="auto z názvu">
          </div>
        </div>
        <div class="admin-row">
          <div class="admin-field">
            <label class="admin-label">Typ</label>
            <input class="admin-input" id="f-loc-type" type="text" value="${_esc(l?.type||'')}" placeholder="město, tábor...">
          </div>
          <div class="admin-field">
            <label class="admin-label">Status</label>
            <input class="admin-input" id="f-loc-status" type="text" value="${_esc(l?.status||'')}" placeholder="bezpečné, aktivní...">
          </div>
        </div>
        <div class="admin-field">
          <label class="admin-label">Úroveň znalosti: <span id="loc-know-val">${l?.knowledge??2}</span></label>
          <input class="admin-range" id="f-loc-knowledge" type="range" min="0" max="4" value="${l?.knowledge??2}"
            oninput="_el('loc-know-val').textContent=this.value">
        </div>
        <div class="admin-field">
          <label class="admin-label">Popis</label>
          <textarea class="admin-input" id="f-loc-desc" rows="4">${_esc(l?.description||'')}</textarea>
        </div>
        <div class="admin-field">
          <label class="admin-label">Poznámky</label>
          <textarea class="admin-input" id="f-loc-notes" rows="2">${_esc(l?.notes||'')}</textarea>
        </div>
        <div class="admin-field">
          <label class="admin-label">Přítomné postavy</label>
          <div class="admin-checks">${_multiSelect(allChars, l?.characters||[], 'id', 'name')}</div>
        </div>

        <div class="admin-actions">
          <button class="admin-btn ok" onclick="Admin.saveLocation()">💾 Uložit</button>
          ${id ? `<button class="admin-btn err" onclick="Admin.deleteLocation('${id}')">🗑 Smazat</button>` : ''}
        </div>
      </div>`;

    if (!id) {
      _el('f-loc-name').addEventListener('input', e =>
        _el('f-loc-id').value = Store.generateId(e.target.value)
      );
    }
  }

  function saveLocation() {
    const name = _val('f-loc-name');
    if (!name) { _toast('Název je povinný!', false); return; }
    const id = _val('f-loc-id') || Store.generateId(name) || 'loc_' + Date.now();
    const chars = Array.from(document.querySelectorAll('.admin-checks input[type=checkbox]:checked'))
      .map(cb => cb.value);
    Store.saveLocation({
      id, name,
      type:       _val('f-loc-type'),
      status:     _val('f-loc-status'),
      knowledge:  parseInt(_val('f-loc-knowledge')||'2'),
      description:_val('f-loc-desc'),
      notes:      _val('f-loc-notes'),
      characters: chars,
      connections:[],
    });
    _toast(`${name} uloženo ✓`);
    _renderList();
  }

  function deleteLocation(id) {
    if (!confirm('Smazat toto místo?')) return;
    Store.deleteLocation(id);
    _editId = null;
    _renderList();
    _el('admin-editor-panel').innerHTML = '<div class="admin-placeholder">Místo smazáno.</div>';
    _toast('Místo smazáno.');
  }

  // ── Event Editor ─────────────────────────────────────────────
  function editEvent(id) {
    _editId = id;
    _renderList();
    const el = _el('admin-editor-panel');
    const e = id ? Store.getEvent(id) : null;
    const allChars = Store.getCharacters();
    const allLocs  = Store.getLocations();

    el.innerHTML = `
      <div class="admin-form">
        <div class="admin-form-title">${id ? 'Upravit: ' + e?.name : 'Nová Událost'}</div>
        <div class="admin-row">
          <div class="admin-field">
            <label class="admin-label">Sezení (prázdné = vzdálená minulost)</label>
            <input class="admin-input" id="f-ev-sitting" type="number" min="1" value="${e?.sitting ?? ''}" placeholder="1, 2, 3…">
          </div>
          <div class="admin-field">
            <label class="admin-label">ID</label>
            <input class="admin-input" id="f-ev-id" type="text" value="${_esc(e?.id||'')}"
              ${id?'readonly style="opacity:0.5"':''} placeholder="auto z názvu">
          </div>
        </div>
        <div class="admin-hint">Pořadí událostí v rámci sezení se nastavuje přetažením oblaků na časové ose.</div>
        <div class="admin-field">
          <label class="admin-label">Název *</label>
          <input class="admin-input" id="f-ev-name" type="text" value="${_esc(e?.name||'')}">
        </div>
        <div class="admin-field">
          <label class="admin-label">Krátký popis (pro mapu)</label>
          <input class="admin-input" id="f-ev-short" type="text" value="${_esc(e?.short||'')}">
        </div>
        <div class="admin-field">
          <label class="admin-label">Plný popis</label>
          <textarea class="admin-input" id="f-ev-desc" rows="5">${_esc(e?.description||'')}</textarea>
        </div>
        <div class="admin-field">
          <label class="admin-label">Zúčastněné postavy</label>
          <div class="admin-checks">${_multiSelect(allChars, e?.characters||[], 'id', 'name')}</div>
        </div>
        <div class="admin-field">
          <label class="admin-label">Místa</label>
          <div class="admin-checks">${_multiSelect(allLocs, e?.locations||[], 'id', 'name')}</div>
        </div>
        <div class="admin-actions">
          <button class="admin-btn ok" onclick="Admin.saveEvent()">💾 Uložit</button>
          ${id ? `<button class="admin-btn err" onclick="Admin.deleteEvent('${id}')">🗑 Smazat</button>` : ''}
        </div>
      </div>`;

    if (!id) {
      _el('f-ev-name').addEventListener('input', e =>
        _el('f-ev-id').value = Store.generateId(e.target.value)
      );
    }
  }

  function saveEvent() {
    const name = _val('f-ev-name');
    if (!name) { _toast('Název je povinný!', false); return; }
    const id = _val('f-ev-id') || Store.generateId(name) || 'ev_' + Date.now();

    const allChecks = document.querySelectorAll('.admin-checks input[type=checkbox]:checked');
    const allLocs = Store.getLocations();
    const charIds = []; const locIds = [];
    allChecks.forEach(cb => {
      if (allLocs.find(l => l.id === cb.value)) locIds.push(cb.value);
      else charIds.push(cb.value);
    });

    const sittingRaw = _val('f-ev-sitting');
    const sitting    = sittingRaw ? (parseInt(sittingRaw) || null) : null;
    // Preserve extra fields not in the form
    const existingEv = id ? (Store.getEvent(id) || {}) : {};
    // Order is owned by the timeline drag-drop. Auto-assign on first save
    // (or when sitting changes) by parking at the end of the target sitting.
    let order = existingEv.order;
    const sittingChanged = existingEv.sitting !== sitting;
    if (order == null || sittingChanged) {
      const tail = Store.getEvents()
        .filter(ev => ev.id !== id && (ev.sitting ?? null) === sitting)
        .reduce((m, ev) => Math.max(m, ev.order ?? 0), 0);
      order = tail + 1;
    }
    Store.saveEvent({
      ...existingEv,
      id, name,
      order,
      sitting,
      short:       _val('f-ev-short'),
      description: _val('f-ev-desc'),
      characters:  charIds,
      locations:   locIds,
    });
    _toast(`${name} uložena ✓`);
    _renderList();
  }

  function deleteEvent(id) {
    if (!confirm('Smazat tuto událost?')) return;
    Store.deleteEvent(id);
    _editId = null;
    _renderList();
    _el('admin-editor-panel').innerHTML = '<div class="admin-placeholder">Událost smazána.</div>';
    _toast('Událost smazána.');
  }

  // ── Mystery Editor ───────────────────────────────────────────
  function editMystery(id) {
    _editId = id;
    _renderList();
    const el = _el('admin-editor-panel');
    const m = id ? Store.getMystery(id) : null;
    const allChars = Store.getCharacters();

    const prioOpts = PRIORITIES.map(p =>
      `<option value="${p}" ${m?.priority===p?'selected':''}>${p.charAt(0).toUpperCase()+p.slice(1)}</option>`
    ).join('');

    el.innerHTML = `
      <div class="admin-form">
        <div class="admin-form-title">${id ? 'Upravit: ' + m?.name : 'Nová Záhada'}</div>

        <div class="admin-row">
          <div class="admin-field">
            <label class="admin-label">Název *</label>
            <input class="admin-input" id="f-mys-name" type="text" value="${_esc(m?.name||'')}">
          </div>
          <div class="admin-field">
            <label class="admin-label">ID</label>
            <input class="admin-input" id="f-mys-id" type="text" value="${_esc(m?.id||'')}"
              ${id?'readonly style="opacity:0.5"':''}>
          </div>
        </div>
        <div class="admin-field">
          <label class="admin-label">Priorita</label>
          <select class="admin-input" id="f-mys-priority">${prioOpts}</select>
        </div>
        <div class="admin-field">
          <label class="admin-label">Popis</label>
          <textarea class="admin-input" id="f-mys-desc" rows="4">${_esc(m?.description||'')}</textarea>
        </div>
        <div class="admin-field">
          <label class="admin-label">Spojené postavy</label>
          <div class="admin-checks">${_multiSelect(allChars, m?.characters||[], 'id', 'name')}</div>
        </div>

        <div class="admin-actions">
          <button class="admin-btn ok" onclick="Admin.saveMystery()">💾 Uložit</button>
          ${id ? `<button class="admin-btn err" onclick="Admin.deleteMystery('${id}')">🗑 Smazat</button>` : ''}
        </div>
      </div>`;

    if (!id) {
      _el('f-mys-name').addEventListener('input', e =>
        _el('f-mys-id').value = Store.generateId(e.target.value)
      );
    }
  }

  function saveMystery() {
    const name = _val('f-mys-name');
    if (!name) { _toast('Název je povinný!', false); return; }
    const id = _val('f-mys-id') || Store.generateId(name) || 'mys_' + Date.now();
    const chars = Array.from(document.querySelectorAll('.admin-checks input:checked')).map(cb=>cb.value);
    Store.saveMystery({
      id, name,
      priority:    _val('f-mys-priority') || 'střední',
      type:        'question',
      description: _val('f-mys-desc'),
      characters:  chars,
      clues:       [],
    });
    _toast(`${name} uložena ✓`);
    _renderList();
  }

  function deleteMystery(id) {
    if (!confirm('Smazat tuto záhadu?')) return;
    Store.deleteMystery(id);
    _editId = null;
    _renderList();
    _el('admin-editor-panel').innerHTML = '<div class="admin-placeholder">Záhada smazána.</div>';
    _toast('Záhada smazána.');
  }

  // ── Faction List & Editor ────────────────────────────────────
  function _factionList() {
    const factions = Store.getFactions();
    const chars    = Store.getCharacters();
    return `
      <div class="admin-list-header">
        <span>${Object.keys(factions).length} frakcí</span>
        <button class="admin-btn-sm ok" onclick="Admin.editFaction(null)">+ Nová</button>
      </div>
      <div class="admin-list-items">
        ${Object.entries(factions).map(([id, f]) => {
          const count = chars.filter(c => c.faction === id).length;
          return `
            <div class="admin-list-item ${_editId===id?'active':''}" onclick="Admin.editFaction('${id}')">
              <div class="ali-info">
                <div class="ali-name">${f.badge} ${f.name}</div>
                <div class="ali-sub">${count} postav · ${(f.rankChains||[]).length} řetězců hodností</div>
              </div>
              <span class="admin-pill" style="background:${f.color}33;color:${f.color};border:1px solid ${f.color}55">${id}</span>
            </div>`;
        }).join('')}
      </div>`;
  }

  function editFaction(id) {
    _editId = id;
    _renderList();
    const el = _el('admin-editor-panel');
    const f  = id ? Store.getFaction(id) : null;

    const chainsHtml = (f?.rankChains || []).map((ch, ci) => `
      <div class="rank-chain-edit" data-chain-id="${_esc(ch.id||'')}">
        <div class="rank-chain-edit-header">
          <input class="admin-input edit-input-sm" placeholder="Název řetězce" value="${_esc(ch.name||'')}" style="flex:1">
          <button type="button" class="admin-icon-btn" onclick="this.closest('.rank-chain-edit').remove()">✕</button>
        </div>
        <div class="dyn-list rank-ranks-list" id="adm-ranks-${ci}">
          ${(ch.ranks||[]).map(r => `
            <div class="dyn-item">
              <input class="admin-input dyn-item-input" type="text" value="${_esc(r)}" placeholder="Hodnost">
              <button type="button" class="admin-icon-btn" onclick="this.parentElement.remove()">✕</button>
            </div>`).join('')}
        </div>
        <button type="button" class="admin-btn-sm" style="margin-top:0.3rem"
          onclick="Admin.addAdminRankRow(this.previousElementSibling.id)">+ Hodnost</button>
      </div>`).join('');

    el.innerHTML = `
      <div class="admin-form">
        <div class="admin-form-title">${id ? 'Upravit: ' + (f?.name||'?') : 'Nová Frakce'}</div>

        <div class="admin-row">
          <div class="admin-field">
            <label class="admin-label">Název *</label>
            <input class="admin-input" id="ff-adm-name" type="text" value="${_esc(f?.name||'')}" placeholder="Název frakce">
          </div>
          <div class="admin-field">
            <label class="admin-label">ID</label>
            <input class="admin-input" id="ff-adm-id" type="text" value="${_esc(id||'')}"
              ${id?'readonly style="opacity:0.5"':''} placeholder="auto z názvu">
          </div>
        </div>
        <div class="admin-row">
          <div class="admin-field">
            <label class="admin-label">Odznak (emoji)</label>
            <input class="admin-input" id="ff-adm-badge" type="text" value="${_esc(f?.badge||'⚐')}" style="font-size:1.3rem">
          </div>
          <div class="admin-field">
            <label class="admin-label">Barva pozadí</label>
            <div style="display:flex;gap:0.5rem;align-items:center">
              <input type="color" id="ff-adm-color-pick" value="${_esc(f?.color||'#555555')}"
                style="width:40px;height:32px;padding:2px;cursor:pointer;background:none;border:1px solid rgba(212,184,122,0.2);border-radius:4px"
                oninput="_el('ff-adm-color').value=this.value">
              <input class="admin-input" id="ff-adm-color" type="text" value="${_esc(f?.color||'#555555')}" placeholder="#RRGGBB"
                oninput="_el('ff-adm-color-pick').value=this.value">
            </div>
          </div>
          <div class="admin-field">
            <label class="admin-label">Barva textu</label>
            <div style="display:flex;gap:0.5rem;align-items:center">
              <input type="color" id="ff-adm-textcolor-pick" value="${_esc(f?.textColor||'#E0E0E0')}"
                style="width:40px;height:32px;padding:2px;cursor:pointer;background:none;border:1px solid rgba(212,184,122,0.2);border-radius:4px"
                oninput="_el('ff-adm-textcolor').value=this.value">
              <input class="admin-input" id="ff-adm-textcolor" type="text" value="${_esc(f?.textColor||'#E0E0E0')}" placeholder="#RRGGBB"
                oninput="_el('ff-adm-textcolor-pick').value=this.value">
            </div>
          </div>
        </div>
        <div class="admin-field">
          <label class="admin-label">Popis (volitelný)</label>
          <textarea class="admin-input" id="ff-adm-desc" rows="3">${_esc(f?.description||'')}</textarea>
        </div>
        <div class="admin-field">
          <label class="admin-label">Hodnostní řetězce
            <span style="font-weight:400;opacity:0.6;margin-left:0.5rem;font-size:0.75rem">od nejvyšší po nejnižší hodnost</span>
          </label>
          <div id="adm-chains">${chainsHtml}</div>
          <button type="button" class="admin-btn-sm" style="margin-top:0.5rem"
            onclick="Admin.addAdminRankChain()">+ Přidat řetězec</button>
        </div>

        <div class="admin-actions">
          <button class="admin-btn ok" onclick="Admin.saveFaction()">💾 Uložit</button>
          ${id ? `<button class="admin-btn err" onclick="Admin.deleteFaction('${id}')">🗑 Smazat</button>` : ''}
        </div>
      </div>`;

    if (!id) {
      _el('ff-adm-name').addEventListener('input', e =>
        _el('ff-adm-id').value = Store.generateId(e.target.value)
      );
    }
  }

  function addAdminRankChain() {
    const container = _el('adm-chains');
    if (!container) return;
    const ci  = container.querySelectorAll('.rank-chain-edit').length;
    const div = document.createElement('div');
    div.innerHTML = `
      <div class="rank-chain-edit" data-chain-id="">
        <div class="rank-chain-edit-header">
          <input class="admin-input edit-input-sm" placeholder="Název řetězce" value="" style="flex:1">
          <button type="button" class="admin-icon-btn" onclick="this.closest('.rank-chain-edit').remove()">✕</button>
        </div>
        <div class="dyn-list rank-ranks-list" id="adm-ranks-n${ci}"></div>
        <button type="button" class="admin-btn-sm" style="margin-top:0.3rem"
          onclick="Admin.addAdminRankRow('adm-ranks-n${ci}')">+ Hodnost</button>
      </div>`;
    container.appendChild(div.firstElementChild);
    container.lastElementChild?.querySelector('input')?.focus();
  }

  function addAdminRankRow(listId) {
    const list = _el(listId);
    if (!list) return;
    const div = document.createElement('div');
    div.innerHTML = `<div class="dyn-item">
      <input class="admin-input dyn-item-input" type="text" value="" placeholder="Hodnost">
      <button type="button" class="admin-icon-btn" onclick="this.parentElement.remove()">✕</button>
    </div>`;
    list.appendChild(div.firstElementChild);
    list.lastElementChild?.querySelector('input')?.focus();
  }

  function saveFaction() {
    const name = _val('ff-adm-name');
    if (!name) { _toast('Název je povinný!', false); return; }
    const id = _val('ff-adm-id') || Store.generateId(name) || 'frakce_' + Date.now();

    const chainEls = document.querySelectorAll('#adm-chains .rank-chain-edit');
    const rankChains = Array.from(chainEls).map(el => {
      const chainName = el.querySelector('input[placeholder="Název řetězce"]')?.value.trim() || "";
      const chainId   = el.dataset.chainId || Store.generateId(chainName) || ('chain_' + Date.now());
      const ranks     = Array.from(el.querySelectorAll('.rank-ranks-list .dyn-item-input'))
                          .map(i => i.value.trim()).filter(Boolean);
      return { id: chainId, name: chainName, ranks };
    }).filter(ch => ch.name);

    const existing = _editId ? (Store.getFaction(_editId) || {}) : {};
    Store.saveFaction(id, {
      ...existing,
      name,
      color:       _val('ff-adm-color')     || '#555555',
      textColor:   _val('ff-adm-textcolor') || '#E0E0E0',
      badge:       _val('ff-adm-badge')     || '⚐',
      description: _val('ff-adm-desc'),
      rankChains,
    });
    _editId = id;
    _toast(`${name} uložena ✓`);
    _renderList();
  }

  function deleteFaction(id) {
    const f = Store.getFaction(id);
    if (!f) return;
    if (!confirm(`Smazat frakci „${f.name}"? Postavy ji budou mít stále přiřazenou dokud ji ručně nezměníte.`)) return;
    Store.deleteFaction(id);
    _editId = null;
    _el('admin-editor-panel').innerHTML = '<div class="admin-placeholder">Frakce smazána.</div>';
    _renderList();
    _toast('Frakce smazána.');
  }

  // ── Portrait file migration ──────────────────────────────────
  // Calls the server endpoint that moves files from the staging directory
  // web/portraits/ into the structured data/portraits/{charId}/ layout
  // and patches campaign.json with the new URLs.
  // Safe to run multiple times — already-moved files are skipped.
  async function migratePortraits() {
    _toast('Migruji portréty na server…');
    try {
      const res  = await fetch('/api/migrate-portraits', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Chyba serveru');

      const movedNames = (data.moved || []).map(m => m.charId).join(', ') || '—';
      _toast(`✓ Přesunuto: ${data.moved.length}, přeskočeno: ${data.skipped.length}, aktualizováno v JSON: ${data.campaignUpdated}`);

      // Reload fresh data from server so the UI reflects the new portrait URLs
      if (data.campaignUpdated > 0) {
        await Store.load();
        _renderList();
      }
    } catch(e) {
      _toast('Migrace selhala: ' + e.message, false);
      console.error(e);
    }
  }

  // ── Legacy: re-upload any remaining base64 portraits to server ──
  async function compressPortraitsInStorage() {
    const chars = Store.getCharacters().filter(c => c.portrait && c.portrait.startsWith('data:'));
    if (!chars.length) {
      _toast('Žádné base64 portréty k migraci ✓');
      return;
    }
    _toast(`Nahrávám ${chars.length} portrét(ů) na server…`);
    let done = 0;
    for (const char of chars) {
      try {
        const res  = await fetch(char.portrait);
        const blob = await res.blob();
        const file = new File([blob], `${char.id}.jpg`, { type: blob.type || 'image/jpeg' });
        const url       = await Store.uploadPortrait(file, char.id);
        const bustedUrl = url + '?v=' + Date.now();
        const fresh = Store.getCharacter(char.id);
        if (fresh) Store.saveCharacter({ ...fresh, portrait: bustedUrl });
        done++;
      } catch(e) {
        console.warn('Migration failed for', char.id, e);
      }
    }
    _toast(`Hotovo — nahráno ${done}/${chars.length} portrét(ů) ✓`);
    _renderList();
  }

  // ── Backup / Restore (JSON) ──────────────────────────────────
  function backupJSON() {
    const content = Store.exportJSON();
    const ts      = new Date().toISOString().slice(0,10);
    const blob    = new Blob([content], { type: 'application/json' });
    const url     = URL.createObjectURL(blob);
    const a       = document.createElement('a');
    a.href        = url;
    a.download    = `o-barvach-draku-zaloha-${ts}.json`;
    a.click();
    URL.revokeObjectURL(url);
    _toast('Záloha stažena ✓');
  }

  function restoreJSON(input) {
    const file = input.files[0];
    if (!file) return;
    if (!confirm('Nahradit VŠECHNA aktuální data zálohou? Neuložené změny budou ztraceny.')) {
      input.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = e => {
      const ok = Store.importJSON(e.target.result);
      if (ok) {
        _toast('Data obnovena ze zálohy ✓');
        render();
      } else {
        _toast('Neplatný soubor zálohy — data nebyla změněna.', false);
      }
      input.value = '';
    };
    reader.readAsText(file);
  }

  // ── Export / Reset ───────────────────────────────────────────
  function exportData() {
    const code = Store.exportJS();
    const blob = new Blob([code], { type: 'text/javascript' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'data-export.js';
    a.click();
    URL.revokeObjectURL(url);
    _toast('Export stažen jako data-export.js ✓');
  }

  function confirmReset() {
    if (!confirm('Opravdu smazat VŠECHNY změny a vrátit se k výchozím datům? Tuto akci nelze vzít zpět.')) return;
    Store.reset();
    _toast('Data resetována na výchozí stav.');
    render();
  }

  // ── Public API ───────────────────────────────────────────────
  return {
    render, switchTab,
    editCharacter, saveCharacter, deleteCharacter,
    handlePortraitUpload, clearPortrait, updateRankOpts,
    addLocRole,
    editRelationship, saveRelationship, deleteRelByIndex, updateRelPreview,
    editLocation, saveLocation, deleteLocation,
    editEvent, saveEvent, deleteEvent,
    editMystery, saveMystery, deleteMystery,
    editFaction, saveFaction, deleteFaction,
    addAdminRankChain, addAdminRankRow,
    backupJSON, restoreJSON,
    migratePortraits, compressPortraitsInStorage,
    exportData, confirmReset,
    addDynRow,
  };
})();

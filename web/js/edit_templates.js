import { Store } from './store.js';
import { PIN_TYPES } from './map.js';

export const EditTemplates = (() => {

  function _esc(s) {
    return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;")
                          .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  function _dynRow(value) {
    return `<div class="dyn-item">
      <input class="edit-input" value="${_esc(value)}" placeholder="…">
      <button class="dyn-remove-btn" onclick="this.parentElement.remove()">×</button>
    </div>`;
  }

  /** Sort characters by faction order then alphabetically, with faction badge prefix.
   *  Returns the sorted array (does not mutate the original). */
  function _sortedChars(chars) {
    const factions = Store.getFactions();
    const fOrder   = Object.keys(factions);
    return [...chars].sort((a, b) => {
      const fa = fOrder.indexOf(a.faction);
      const fb = fOrder.indexOf(b.faction);
      const ia = fa < 0 ? 999 : fa;
      const ib = fb < 0 ? 999 : fb;
      if (ia !== ib) return ia - ib;
      return (a.name || '').localeCompare(b.name || '', 'cs');
    });
  }

  function _charBadge(c) {
    const f = Store.getFactions()[c.faction];
    return f ? f.badge + ' ' : '';
  }

  // ── Relationship type configuration ──────────────────────────
  // Each type defines: label, allowed target type, allowed directions.
  // Directions: 'from' = this char → target, 'to' = target → this char, 'both' = bidirectional.
  const REL_CONFIG = {
    commands:    { label: 'velí',          target: 'character', dirs: ['from', 'to'] },
    ally:        { label: 'spojenec',      target: 'character', dirs: ['from','to','both'] },
    enemy:       { label: 'nepřítel',      target: 'character', dirs: ['from','to','both'] },
    mission:     { label: 'mise',          target: 'location',  dirs: ['from'] },
    mystery:     { label: 'záhada',        target: 'character', dirs: ['from','to','both'] },
    captured_by: { label: 'zajat/a',       target: 'character', dirs: ['from','to'] },
    history:     { label: 'historie',      target: 'character', dirs: ['from','to','both'] },
    uncertain:   { label: 'nejasná vazba', target: 'character', dirs: ['from','to','both'] },
    negotiates:  { label: 'vyjednává',     target: 'character', dirs: ['from','to','both'] },
  };
  const REL_TYPES  = Object.keys(REL_CONFIG);
  const REL_LABELS = Object.fromEntries(REL_TYPES.map(t => [t, REL_CONFIG[t].label]));

  const DIR_LABELS = {
    from: 'Tato postava →',
    to:   '← Na tuto postavu',
    both: '↔ Oboustranná',
  };

  /** Build a Combobox placeholder for the relationship target picker.
   *  Replaces the legacy <select> + <option> list — values are still readable
   *  via document.getElementById(`${prefix}-target`).value because the
   *  Combobox renders a hidden <input type="hidden"> with that id. */
  function _targetMount(type, charId, selectedId, prefix) {
    const cfg     = REL_CONFIG[type] || REL_CONFIG.commands;
    const source  = cfg.target === 'location' ? 'location' : 'character';
    const exclude = cfg.target === 'character' ? charId : '';
    const placeholder = cfg.target === 'location' ? 'Vyber místo…' : 'Vyber postavu…';
    return `<div class="cb-mount rel-target-cb"
              data-cb-id="${prefix}-target"
              data-cb-source="${source}"
              data-cb-exclude="${_esc(exclude)}"
              data-cb-value="${_esc(selectedId || '')}"
              data-cb-placeholder="${placeholder}"
              data-cb-on-create="${source}"></div>`;
  }

  /** Build <option> list for directions based on type config */
  function _dirOpts(type, selectedDir) {
    const cfg = REL_CONFIG[type] || REL_CONFIG.commands;
    return cfg.dirs.map(d =>
      `<option value="${d}" ${d===selectedDir?'selected':''}>${DIR_LABELS[d]}</option>`
    ).join('');
  }

  /** Render a single relationship row (existing or new) */
  function _relRow(charId, r, idx) {
    const isNew    = idx === 'new';
    const prefix   = isNew ? `rf-new-${charId}` : `rf-${idx}-${charId}`;
    const type     = r ? r.type : REL_TYPES[0];
    const label    = r ? (r.label || '') : '';

    // Determine current direction and other end from existing relationship
    let dir = 'from', targetId = '';
    if (r) {
      if (r.source === charId)      { dir = 'from'; targetId = r.target; }
      else if (r.target === charId) { dir = 'to';   targetId = r.source; }
    }

    const typeOpts   = REL_TYPES.map(t =>
      `<option value="${t}" ${t===type?'selected':''}>${REL_CONFIG[t].label}</option>`
    ).join('');
    const dirOptions = _dirOpts(type, dir);
    const tgtMount   = _targetMount(type, charId, targetId, prefix);

    const saveAction = isNew
      ? `EditMode.addRelationship('${charId}')`
      : `EditMode.updateRelationship('${charId}',${idx})`;
    const deleteBtn  = isNew ? '' :
      `<button class="rel-delete-btn" title="Smazat"
         onclick="EditMode.deleteRelationship('${r.source}','${r.target}','${r.type}','${charId}')">×</button>`;
    const saveLabel  = isNew ? '+ Přidat' : '💾';
    const saveTitle  = isNew ? 'Přidat vazbu' : 'Uložit změny';

    return `<div class="rel-edit-row" data-idx="${idx}">
      <select class="edit-select edit-select-sm" id="${prefix}-type"
        onchange="EditMode.relTypeChanged('${charId}','${prefix}')">${typeOpts}</select>
      <select class="edit-select edit-select-sm" id="${prefix}-dir">${dirOptions}</select>
      <div class="rel-target-wrap">${tgtMount}</div>
      <input class="edit-input edit-input-sm" id="${prefix}-label" value="${_esc(label)}"
        placeholder="${_esc(REL_CONFIG[type].label)}">
      <button class="edit-add-btn" onclick="${saveAction}" title="${saveTitle}">${saveLabel}</button>
      ${deleteBtn}
    </div>`;
  }

  function _relSection(charId) {
    const rels = Store.getRelationships().filter(r => r.source === charId || r.target === charId);

    const existingRows = rels.map((r, i) => _relRow(charId, r, i)).join('');
    const newRow = _relRow(charId, null, 'new');

    return `
      <div class="edit-section" id="rel-section-${charId}">
        <div class="edit-section-title">Vazby</div>
        <div class="rel-edit-list" id="rel-list-${charId}">
          ${existingRows || `<span class="edit-hint">Žádné vazby</span>`}
        </div>
        <div class="rel-add-form">${newRow}</div>
      </div>`;
  }

  function renderCharacterEditor(c) {
    const isNew = !c || !c.id;
    if (isNew) {
      const defaults = { id:"", name:"", title:"", faction:"neutral", status:"alive",
                         knowledge:3, description:"", portrait:"", location:"",
                         rankChain:"", rank:"", locationRoles:[],
                         species:"", gender:"", age:"",
                         known:[], unknown:[], tags:[] };
      c = { ...defaults, ...(c || {}) };
    }
    const uid = c.id || "new";
    const factions  = Store.getFactions();
    const statusMap = Store.getStatusMap();
    const KNAMES = ["Neznámý","Tušený","Základní","Dobře znám","Plně zmapován"];

    const fOpts = Object.entries(factions).map(([id,f]) =>
      `<option value="${id}" ${c.faction===id?"selected":""}>${f.badge} ${f.name}</option>`).join("");
    const sOpts = Object.entries(statusMap).map(([id,s]) =>
      `<option value="${id}" ${c.status===id?"selected":""}>${s.icon} ${s.label}</option>`).join("");
    const knownRows   = (c.known   || []).map(_dynRow).join("");
    const unknownRows = (c.unknown || []).map(_dynRow).join("");
    const badge = factions[c.faction]?.badge || "👤";

    return `
      <button class="back-btn" onclick="history.back()">← Zpět</button>
      <div class="edit-form" style="max-width:860px">
        <div class="edit-form-header">
          <h2 class="edit-form-title">${isNew ? "✦ Nová postava" : "✏ " + _esc(c.name)}</h2>
          <div class="edit-hdr-actions">
            <button class="edit-save-btn" onclick="EditMode.saveCharacter('${c.id}')">💾 Uložit</button>
            ${!isNew ? `<button class="edit-delete-btn" onclick="EditMode.deleteCharacter('${c.id}')">🗑 Smazat</button>` : ""}
          </div>
        </div>
        <div class="edit-main-grid">
          <div class="edit-portrait-col">
            <div class="edit-portrait-preview" id="ep-preview-${uid}">
              ${c.portrait
                ? `<img src="${c.portrait}" style="width:100%;height:100%;object-fit:cover;object-position:top">`
                : `<span style="font-size:2.5rem">${badge}</span>`}
            </div>
            <label class="edit-upload-btn">
              📷 Nahrát portrét
              <input type="file" accept="image/*" style="display:none"
                onchange="EditMode.handlePortraitUpload(this,'${uid}')">
            </label>
            ${c.portrait ? `<button class="edit-remove-portrait-btn"
              onclick="document.getElementById('ep-preview-${uid}').innerHTML='<span style=\\'font-size:2.5rem\\'>${badge}</span>';document.getElementById('ep-data-${uid}').value=''">
              × Odebrat
            </button>` : ""}
            <input type="hidden" id="ep-data-${uid}" value="${_esc(c.portrait)}">
          </div>
          <div class="edit-fields-col">
            <div class="edit-row-2">
              <div class="edit-field">
                <label class="edit-label">Jméno *</label>
                <input class="edit-input" id="ef-name-${uid}" value="${_esc(c.name)}" placeholder="Jméno postavy">
              </div>
              <div class="edit-field">
                <label class="edit-label">Titul / Krátký popis</label>
                <input class="edit-input" id="ef-title-${uid}" value="${_esc(c.title)}" placeholder="Titul nebo profese">
              </div>
            </div>
            <div class="edit-row-2">
              <div class="edit-field">
                <label class="edit-label">Frakce</label>
                <select class="edit-select" id="ef-faction-${uid}">${fOpts}</select>
              </div>
              <div class="edit-field">
                <label class="edit-label">Status</label>
                <select class="edit-select" id="ef-status-${uid}">${sOpts}</select>
              </div>
            </div>
            <div class="edit-row-3">
              <div class="edit-field">
                <label class="edit-label">Druh</label>
                <input class="edit-input" id="ef-species-${uid}" value="${_esc(c.species)}" placeholder="Člověk, Elf, Drak…">
              </div>
              <div class="edit-field">
                <label class="edit-label">Pohlaví</label>
                <input class="edit-input" id="ef-gender-${uid}" value="${_esc(c.gender)}" placeholder="muž / žena / …">
              </div>
              <div class="edit-field">
                <label class="edit-label">Věk</label>
                <input class="edit-input" id="ef-age-${uid}" value="${_esc(c.age)}" placeholder="32 / starý / neznámý">
              </div>
            </div>
            <div class="edit-field">
              <label class="edit-label" id="ef-kl-${uid}">Znalost (${c.knowledge}/4) — ${KNAMES[c.knowledge]}</label>
              <input type="range" class="edit-range" id="ef-knowledge-${uid}" min="0" max="4" value="${c.knowledge}"
                oninput="document.getElementById('ef-kl-${uid}').textContent='Znalost ('+this.value+'/4) — '+['Neznámý','Tušený','Základní','Dobře znám','Plně zmapován'][this.value]">
              <div class="edit-range-labels"><span>Neznámý</span><span>Plně zmapován</span></div>
            </div>
            <div class="edit-field">
              <label class="edit-label">Popis</label>
              <textarea class="edit-textarea" id="ef-desc-${uid}" rows="4">${_esc(c.description)}</textarea>
            </div>
          </div>
        </div>
        <div class="edit-section">
          <div class="edit-section-title">Co víme</div>
          <div class="dyn-list" id="dyn-known-${uid}">${knownRows}</div>
          <button class="dyn-add-btn" onclick="EditMode.addDynRow('dyn-known-${uid}')">+ Přidat</button>
        </div>
        <div class="edit-section">
          <div class="edit-section-title">Otevřené otázky</div>
          <div class="dyn-list" id="dyn-unknown-${uid}">${unknownRows}</div>
          <button class="dyn-add-btn" onclick="EditMode.addDynRow('dyn-unknown-${uid}')">+ Přidat</button>
        </div>
        ${!isNew ? _relSection(c.id) : `
          <div class="edit-section">
            <div class="edit-section-title">Vazby</div>
            <p class="edit-hint">Uložte postavu nejprve, pak přidejte vazby.</p>
          </div>`}
        <div class="edit-bottom-actions">
          <button class="edit-save-btn" onclick="EditMode.saveCharacter('${c.id}')">💾 Uložit změny</button>
          ${!isNew ? `<button class="edit-delete-btn" onclick="EditMode.deleteCharacter('${c.id}')">🗑 Smazat postavu</button>` : ""}
        </div>
      </div>
    `;
  }

  function renderLocationEditor(l) {
    const isNew = !l || !l.id;
    if (isNew) {
      const defaults = { id:"", name:"", type:"", status:"", description:"", notes:"",
                         parentId:"", localMap:"" };
      l = { ...defaults, ...(l || {}) };
    }
    const uid = l.id || "new_loc";

    // Characters present here: driven by character.location (single source of truth).
    const presentChars = l.id ? Store.getCharactersInLocation(l.id) : [];
    const presentIds   = presentChars.map(c => c.id).join(',');
    const charsPicker = l.id ? `<div class="ms-mount"
      id="lf-chars-${uid}"
      data-ms-source="character"
      data-ms-value="${_esc(presentIds)}"
      data-ms-placeholder="Hledej postavu a přidej…"
      data-ms-on-create="character"
      data-loc-id="${_esc(l.id)}"></div>
      <div class="edit-hint" style="margin-top:0.25rem">Postava může být vždy jen na jednom místě — přidání sem ji odebere z předchozího místa.</div>`
      : `<div class="edit-hint">Uložte místo, pak přidejte přítomné postavy.</div>`;

    // Typ dropdown: PIN_TYPES entries with their icons, plus "custom"
    // fallback. Current pinType wins; if only the legacy text `type` is
    // set, try matching it to a PIN_TYPES label.
    let selectedPinType = l.pinType || '';
    if (!selectedPinType && l.type) {
      const match = Object.entries(PIN_TYPES).find(([, v]) => v.label === l.type);
      if (match) selectedPinType = match[0];
    }
    const typeOpts = `<option value="" ${!selectedPinType?'selected':''}>— neurčeno —</option>` +
      Object.entries(PIN_TYPES)
        .map(([k, v]) => `<option value="${_esc(k)}" ${selectedPinType===k?'selected':''}>${v.icon} ${_esc(v.label)}</option>`)
        .join('');

    // Status dropdown: existing non-empty statuses across all Locations,
    // plus a blank option. New status values can still be introduced by
    // editing an existing one in-place (next user picks it up here).
    const existingStatuses = [...new Set(Store.getLocations().map(x => x.status).filter(Boolean))];
    if (l.status && !existingStatuses.includes(l.status)) existingStatuses.push(l.status);
    const statusOpts = `<option value="" ${!l.status?'selected':''}>— neurčeno —</option>` +
      existingStatuses.map(s => `<option value="${_esc(s)}" ${l.status===s?'selected':''}>${_esc(s)}</option>`).join('') +
      `<option value="__custom__">✎ Vlastní…</option>`;

    // Subplace hierarchy: parent picker excludes self (and could exclude
    // descendants but a deep cycle check belongs in save).
    const parentMount = `<div class="cb-mount"
      data-cb-id="lf-parent-${uid}"
      data-cb-source="location"
      data-cb-value="${_esc(l.parentId || '')}"
      data-cb-exclude="${_esc(l.id || '')}"
      data-cb-allow-empty="1"
      data-cb-empty-label="— žádné (samostatné místo) —"
      data-cb-placeholder="Vyber rodičovské místo…"></div>`;

    const onMap = (typeof l.x === 'number' && typeof l.y === 'number');
    const mapBadge = onMap
      ? `<span class="badge" style="background:rgba(46,125,50,0.18);color:#a5d6a7">📍 Na mapě</span>`
      : `<span class="badge" style="background:rgba(255,255,255,0.07);color:var(--text-muted)">Není na mapě</span>`;

    const mapControls = isNew
      ? `<div class="edit-hint">Pin lze umístit po prvním uložení místa.</div>`
      : onMap
        ? `<div class="inline-create-row">
             <button type="button" class="inline-create-btn" onclick="WorldMap.showPin('${l.id}')">🧭 Zobrazit na mapě</button>
             <button type="button" class="inline-create-btn" onclick="WorldMap.startPlacingPin('${l.id}')">📍 Přemístit</button>
             <button type="button" class="edit-delete-btn" onclick="WorldMap.deletePin('${l.id}')">🗑 Odebrat z mapy</button>
           </div>`
        : `<div class="inline-create-row">
             <button type="button" class="inline-create-btn" onclick="WorldMap.startPlacingPin('${l.id}')">📍 Umístit na mapu</button>
           </div>`;

    const localMapPreview = l.localMap
      ? `<div class="lf-localmap-preview"><img src="${_esc(l.localMap)}" alt=""></div>`
      : '';

    return `
      <button class="back-btn" onclick="history.back()">← Zpět</button>
      <div class="edit-form" style="max-width:760px">
        <div class="edit-form-header">
          <h2 class="edit-form-title">${isNew ? "✦ Nové místo" : "✏ " + _esc(l.name)}</h2>
          <div class="edit-hdr-actions">
            <button class="edit-save-btn" onclick="EditMode.saveLocation('${l.id}')">💾 Uložit</button>
            ${!isNew ? `<button class="edit-delete-btn" onclick="EditMode.deleteLocation('${l.id}')">🗑 Smazat</button>` : ""}
          </div>
        </div>
        <div class="edit-row-2">
          <div class="edit-field">
            <label class="edit-label">Název *</label>
            <input class="edit-input" id="lf-name-${uid}" value="${_esc(l.name)}" placeholder="Název místa">
          </div>
          <div class="edit-field">
            <label class="edit-label">Typ</label>
            <select class="edit-input" id="lf-type-${uid}">${typeOpts}</select>
          </div>
        </div>
        <div class="edit-field">
          <label class="edit-label">Status</label>
          <select class="edit-input" id="lf-status-${uid}"
            onchange="EditMode.onLocationStatusChange('${uid}')">${statusOpts}</select>
          <input class="edit-input" id="lf-status-custom-${uid}" type="text"
            placeholder="Zadej vlastní status…" style="margin-top:0.4rem;display:none">
        </div>
        <div class="edit-field">
          <label class="edit-label">Popis</label>
          <textarea class="edit-textarea" id="lf-desc-${uid}" rows="4">${_esc(l.description)}</textarea>
        </div>
        <div class="edit-field">
          <label class="edit-label">Záhadné poznámky</label>
          <textarea class="edit-textarea" id="lf-notes-${uid}" rows="2">${_esc(l.notes||"")}</textarea>
        </div>

        <div class="edit-section">
          <div class="edit-section-title">Hierarchie a mapa <span class="edit-hint" style="font-weight:normal;margin-left:0.5rem">${mapBadge}</span></div>
          <div class="edit-field">
            <label class="edit-label">Pin na mapě</label>
            ${mapControls}
          </div>
          <div class="edit-field">
            <label class="edit-label">Rodičovské místo (volitelné — pro dílčí mapy)</label>
            ${parentMount}
            <div class="edit-hint" style="margin-top:0.25rem">Např. dungeon uvnitř města. Toto místo se objeví na mapě rodiče.</div>
          </div>
          <div class="edit-field">
            <label class="edit-label">Vlastní mapa (volitelné — pro dílčí mapu tohoto místa)</label>
            <div class="lf-localmap-row">
              <input class="edit-input" id="lf-localmap-${uid}" value="${_esc(l.localMap||'')}" placeholder="/maps/local/... nebo nahraj obrázek →">
              ${!isNew ? `<label class="edit-upload-btn" title="Nahrát obrázek">
                📤 Nahrát
                <input type="file" accept="image/*" style="display:none"
                  onchange="EditMode.uploadLocalMap('${l.id}', this.files[0], 'lf-localmap-${uid}')">
              </label>` : `<span class="edit-hint" style="align-self:center">(uložte místo, pak nahrajte)</span>`}
            </div>
            ${localMapPreview}
            <div class="edit-hint" style="margin-top:0.25rem">Když je vyplněno, na stránce místa se objeví tlačítko 🗺 Místní mapa, kde se zobrazí podřízená místa.</div>
          </div>
        </div>

        <div class="edit-section">
          <div class="edit-section-title">Přítomné postavy</div>
          ${charsPicker}
        </div>
        <div class="edit-bottom-actions">
          <button class="edit-save-btn" onclick="EditMode.saveLocation('${l.id}')">💾 Uložit místo</button>
          ${!isNew ? `<button class="edit-delete-btn" onclick="EditMode.deleteLocation('${l.id}')">🗑 Smazat místo</button>` : ""}
        </div>
      </div>
    `;
  }

  function renderEventEditor(e) {
    const isNew = !e || !e.id;
    if (isNew) {
      const defaults = { id:"", name:"", sitting:null, short:"", description:"", characters:[], locations:[] };
      e = { ...defaults, ...(e || {}) };
    }
    const uid = e.id || "new_ev";

    const charsValue = (e.characters || []).join(',');
    const locsValue  = (e.locations  || []).join(',');
    const charPicker = `<div id="evf-chars-${uid}" class="ms-mount"
      data-ms-source="character"
      data-ms-value="${_esc(charsValue)}"
      data-ms-placeholder="Hledat postavu…"
      data-ms-on-create="character"></div>`;
    const locPicker  = `<div id="evf-locs-${uid}" class="ms-mount"
      data-ms-source="location"
      data-ms-value="${_esc(locsValue)}"
      data-ms-placeholder="Hledat místo…"
      data-ms-on-create="location"></div>`;

    return `
      <button class="back-btn" onclick="history.back()">← Zpět</button>
      <div class="edit-form" style="max-width:760px">
        <div class="edit-form-header">
          <h2 class="edit-form-title">${isNew ? "✦ Nová událost" : "✏ " + _esc(e.name)}</h2>
          <div class="edit-hdr-actions">
            <button class="edit-save-btn" onclick="EditMode.saveEvent('${e.id}')">💾 Uložit</button>
            ${!isNew ? `<button class="edit-delete-btn" onclick="EditMode.deleteEvent('${e.id}')">🗑 Smazat</button>` : ""}
          </div>
        </div>
        <div class="edit-field">
          <label class="edit-label">Název *</label>
          <input class="edit-input" id="evf-name-${uid}" value="${_esc(e.name)}" placeholder="Název události">
          <div class="edit-hint" style="margin-top:0.25rem">Zařazení do sezení a pořadí se nastavuje přetažením kartičky na Časové ose.</div>
        </div>
        <input type="hidden" id="evf-sitting-${uid}" value="${e.sitting ?? ''}">
        <div class="edit-field">
          <label class="edit-label">Krátký popis</label>
          <input class="edit-input" id="evf-short-${uid}" value="${_esc(e.short)}" placeholder="Jedna věta">
        </div>
        <div class="edit-field">
          <label class="edit-label">Podrobný popis</label>
          <textarea class="edit-textarea" id="evf-desc-${uid}" rows="4">${_esc(e.description)}</textarea>
        </div>
        <div class="edit-row-2">
          <div class="edit-section" style="margin-top:0">
            <div class="edit-section-title">Zúčastněné postavy
              <button type="button" class="inline-create-btn" style="margin-left:.5rem"
                onclick="EditMode.addPartyToEvent('evf-chars-${uid}')">🛡 + Naše parta</button>
            </div>
            ${charPicker}
          </div>
          <div class="edit-section" style="margin-top:0">
            <div class="edit-section-title">Místa</div>
            ${locPicker}
          </div>
        </div>
        <div class="edit-field">
          <label class="edit-label">Pin události na mapě</label>
          ${isNew
            ? `<div class="edit-hint">Pin lze umístit po prvním uložení události.</div>`
            : (typeof e.mapX === 'number' && typeof e.mapY === 'number')
              ? `<div style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:center">
                  <button type="button" class="inline-create-btn" onclick="WorldMap.showEventPin('${e.id}')">🧭 Zobrazit pin</button>
                  <button type="button" class="inline-create-btn" onclick="WorldMap.startPlacingEventPin('${e.id}')">📍 Přemístit</button>
                  <button type="button" class="edit-delete-btn" onclick="WorldMap.clearEventPin('${e.id}')">🗑 Odebrat pin</button>
                </div>`
              : `<button type="button" class="inline-create-btn" onclick="WorldMap.startPlacingEventPin('${e.id}')">📍 Umístit pin na mapu</button>`}
        </div>
        <div class="edit-bottom-actions">
          <button class="edit-save-btn" onclick="EditMode.saveEvent('${e.id}')">💾 Uložit událost</button>
          ${!isNew ? `<button class="edit-delete-btn" onclick="EditMode.deleteEvent('${e.id}')">🗑 Smazat událost</button>` : ""}
        </div>
      </div>
    `;
  }

  function renderMysteryEditor(m) {
    const isNew = !m || !m.id;
    if (isNew) m = { id:"", name:"", priority:"střední", description:"", characters:[] };
    const uid = m.id || "new_mys";
    const priOpts = ["kritická","vysoká","střední"].map(p =>
      `<option value="${p}" ${m.priority===p?"selected":""}>${p}</option>`).join("");
    const charsValue = (m.characters || []).join(',');
    const charPicker = `<div id="mf-chars-${uid}" class="ms-mount"
      data-ms-source="character"
      data-ms-value="${_esc(charsValue)}"
      data-ms-placeholder="Hledat postavu…"
      data-ms-on-create="character"></div>`;

    return `
      <button class="back-btn" onclick="history.back()">← Zpět</button>
      <div class="edit-form" style="max-width:640px">
        <div class="edit-form-header">
          <h2 class="edit-form-title">${isNew ? "✦ Nová záhada" : "✏ " + _esc(m.name)}</h2>
          <div class="edit-hdr-actions">
            <button class="edit-save-btn" onclick="EditMode.saveMystery('${m.id}')">💾 Uložit</button>
            ${!isNew ? `<button class="edit-delete-btn" onclick="EditMode.deleteMystery('${m.id}')">🗑 Smazat</button>` : ""}
          </div>
        </div>
        <div class="edit-row-2">
          <div class="edit-field">
            <label class="edit-label">Název záhady *</label>
            <input class="edit-input" id="mf-name-${uid}" value="${_esc(m.name)}" placeholder="Co je záhadou?">
          </div>
          <div class="edit-field">
            <label class="edit-label">Priorita</label>
            <select class="edit-select" id="mf-pri-${uid}">${priOpts}</select>
          </div>
        </div>
        <div class="edit-field">
          <label class="edit-label">Popis / Co víme</label>
          <textarea class="edit-textarea" id="mf-desc-${uid}" rows="4">${_esc(m.description)}</textarea>
        </div>
        <div class="edit-section">
          <div class="edit-section-title">Spojené postavy</div>
          ${charPicker}
        </div>
        <div class="edit-bottom-actions">
          <button class="edit-save-btn" onclick="EditMode.saveMystery('${m.id}')">💾 Uložit záhadu</button>
          ${!isNew ? `<button class="edit-delete-btn" onclick="EditMode.deleteMystery('${m.id}')">🗑 Smazat záhadu</button>` : ""}
        </div>
      </div>
    `;
  }

  function _chainEditHtml(chain, uid, ci) {
    const ranksHtml = (chain.ranks || []).map(r => `
      <div class="dyn-item">
        <input class="edit-input" value="${_esc(r)}" placeholder="Hodnost">
        <button class="dyn-remove-btn" onclick="this.parentElement.remove()">×</button>
      </div>`).join("");
    return `
      <div class="rank-chain-edit" data-chain-id="${_esc(chain.id || '')}">
        <div class="rank-chain-edit-header">
          <input class="edit-input edit-input-sm" placeholder="Název řetězce" value="${_esc(chain.name || '')}" style="flex:1">
          <button class="dyn-remove-btn" title="Odebrat řetězec" onclick="this.closest('.rank-chain-edit').remove()">✕</button>
        </div>
        <div class="dyn-list rank-ranks-list" id="ranks-${uid}-${ci}">
          ${ranksHtml}
        </div>
        <button class="dyn-add-btn" style="margin-top:0.3rem"
          onclick="EditMode.addRankRow(this.previousElementSibling.id)">+ Přidat hodnost</button>
      </div>`;
  }

  function renderFactionEditor(f, facId) {
    const isNew = !f || facId === "new";
    if (isNew) f = { name:"", color:"#555555", textColor:"#E0E0E0", badge:"⚐", description:"", rankChains:[] };
    const uid = (isNew ? "new_fac" : facId).replace(/[^a-z0-9_]/gi, "_");
    const chainsHtml = (f.rankChains || []).map((ch, ci) => _chainEditHtml(ch, uid, ci)).join("");

    return `
      <button class="back-btn" onclick="history.back()">← Zpět</button>
      <div class="edit-form" style="max-width:760px">
        <div class="edit-form-header">
          <h2 class="edit-form-title">${isNew ? "✦ Nová frakce" : "✏ " + _esc(f.name)}</h2>
          <div class="edit-hdr-actions">
            <button class="edit-save-btn" onclick="EditMode.saveFaction('${isNew ? "" : facId}')">💾 Uložit</button>
            ${!isNew ? `<button class="edit-delete-btn" onclick="EditMode.deleteFaction('${facId}')">🗑 Smazat</button>` : ""}
          </div>
        </div>

        <div class="edit-row-2">
          <div class="edit-field">
            <label class="edit-label">Název *</label>
            <input class="edit-input" id="ff-name-${uid}" value="${_esc(f.name)}" placeholder="Název frakce">
          </div>
          <div class="edit-field">
            <label class="edit-label">Odznak</label>
            <input class="edit-input" id="ff-badge-${uid}" value="${_esc(f.badge)}" placeholder="🐉" style="font-size:1.4rem">
          </div>
        </div>
        <div class="edit-row-2">
          <div class="edit-field">
            <label class="edit-label">Barva pozadí</label>
            <div style="display:flex;gap:0.5rem;align-items:center">
              <input type="color" id="ff-color-${uid}" value="${_esc(f.color)}"
                style="width:44px;height:34px;padding:2px;cursor:pointer;background:none;border:1px solid rgba(212,184,122,0.2);border-radius:4px"
                oninput="document.getElementById('ff-color-text-${uid}').value=this.value">
              <input class="edit-input" id="ff-color-text-${uid}" value="${_esc(f.color)}" placeholder="#RRGGBB" style="flex:1"
                oninput="document.getElementById('ff-color-${uid}').value=this.value">
            </div>
          </div>
          <div class="edit-field">
            <label class="edit-label">Barva textu</label>
            <div style="display:flex;gap:0.5rem;align-items:center">
              <input type="color" id="ff-textcolor-${uid}" value="${_esc(f.textColor)}"
                style="width:44px;height:34px;padding:2px;cursor:pointer;background:none;border:1px solid rgba(212,184,122,0.2);border-radius:4px"
                oninput="document.getElementById('ff-textcolor-text-${uid}').value=this.value">
              <input class="edit-input" id="ff-textcolor-text-${uid}" value="${_esc(f.textColor)}" placeholder="#RRGGBB" style="flex:1"
                oninput="document.getElementById('ff-textcolor-${uid}').value=this.value">
            </div>
          </div>
        </div>
        <div class="edit-field">
          <label class="edit-label">Popis frakce (volitelný)</label>
          <textarea class="edit-textarea" id="ff-desc-${uid}" rows="3">${_esc(f.description || '')}</textarea>
        </div>

        <div class="edit-section">
          <div class="edit-section-title">Hodnostní Řetězce
            <span class="edit-hint" style="font-weight:normal;margin-left:0.5rem">od nejvyšší po nejnižší</span>
          </div>
          <div id="chains-${uid}">${chainsHtml}</div>
          <button class="dyn-add-btn" style="margin-top:0.5rem"
            onclick="EditMode.addRankChain('chains-${uid}','${uid}')">+ Přidat řetězec</button>
        </div>

        <div class="edit-bottom-actions">
          <button class="edit-save-btn" onclick="EditMode.saveFaction('${isNew ? "" : facId}')">💾 Uložit frakci</button>
          ${!isNew ? `<button class="edit-delete-btn" onclick="EditMode.deleteFaction('${facId}')">🗑 Smazat frakci</button>` : ""}
        </div>
      </div>
    `;
  }

  return {
    renderCharacterEditor,
    renderLocationEditor,
    renderEventEditor,
    renderMysteryEditor,
    renderFactionEditor,
    getDynRowHtml: _dynRow,
    getRelSectionHtml: _relSection,
    getDirOptsHtml: _dirOpts,
    getTargetMountHtml: _targetMount,
    getRelConfig: () => REL_CONFIG,
    getChainEditHtml: _chainEditHtml,
  };

})();

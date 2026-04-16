import { Store } from './store.js';

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
              data-cb-placeholder="${placeholder}"></div>`;
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
    if (isNew) c = { id:"", name:"", title:"", faction:"neutral", status:"alive",
                     knowledge:3, description:"", portrait:"", location:"",
                     rankChain:"", rank:"", locationRoles:[],
                     known:[], unknown:[], tags:[] };
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
    if (isNew) l = { id:"", name:"", type:"", status:"", description:"", notes:"", characters:[] };
    const uid = l.id || "new_loc";
    const allChars = Store.getCharacters();
    const charChecks = _sortedChars(allChars).map(c => `
      <label class="edit-check">
        <input type="checkbox" value="${c.id}" ${(l.characters||[]).includes(c.id)?"checked":""}>
        ${_charBadge(c)}${_esc(c.name)}
      </label>`).join("");

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
            <input class="edit-input" id="lf-type-${uid}" value="${_esc(l.type)}" placeholder="Město, Pevnost, Tábor…">
          </div>
        </div>
        <div class="edit-field">
          <label class="edit-label">Status</label>
          <input class="edit-input" id="lf-status-${uid}" value="${_esc(l.status)}" placeholder="Pod kontrolou kultu, Neutrální…">
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
          <div class="edit-section-title">Přítomné postavy</div>
          <div class="edit-checks" id="lf-chars-${uid}">${charChecks}</div>
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
    if (isNew) e = { id:"", name:"", order:99, sitting:null, short:"", description:"", characters:[], locations:[], consequence:"" };
    const uid = e.id || "new_ev";
    const allLocs  = Store.getLocations();
    const allEvs   = Store.getEvents();

    const charsValue = (e.characters || []).join(',');
    const locsValue  = (e.locations  || []).join(',');
    const charPicker = `<div id="evf-chars-${uid}" class="ms-mount"
      data-ms-source="character"
      data-ms-value="${_esc(charsValue)}"
      data-ms-placeholder="Hledat postavu…"></div>`;
    const locPicker  = `<div id="evf-locs-${uid}" class="ms-mount"
      data-ms-source="location"
      data-ms-value="${_esc(locsValue)}"
      data-ms-placeholder="Hledat místo…"></div>`;
    const consOpts = `<option value="">— žádná —</option>` +
      allEvs.filter(ev => ev.id !== e.id).map(ev =>
        `<option value="${ev.id}" ${e.consequence===ev.id?"selected":""}>${ev.order}. ${_esc(ev.name)}</option>`
      ).join("");

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
        <div class="edit-row-2">
          <div class="edit-field">
            <label class="edit-label">Název *</label>
            <input class="edit-input" id="evf-name-${uid}" value="${_esc(e.name)}" placeholder="Název události">
          </div>
          <div class="edit-field">
            <label class="edit-label">Pořadí na ose</label>
            <input class="edit-input" type="number" id="evf-order-${uid}" value="${e.order}" min="1">
          </div>
        </div>
        <div class="edit-field">
          <label class="edit-label">Sezení (číslo setkání)</label>
          <input class="edit-input" type="number" id="evf-sitting-${uid}" value="${e.sitting ?? ''}" min="1" placeholder="prázdné = vzdálená minulost">
        </div>
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
            <div class="edit-section-title">Zúčastněné postavy</div>
            ${charPicker}
          </div>
          <div class="edit-section" style="margin-top:0">
            <div class="edit-section-title">Místa</div>
            ${locPicker}
          </div>
        </div>
        <div class="edit-field">
          <label class="edit-label">Navazující událost</label>
          <select class="edit-select" id="evf-cons-${uid}">${consOpts}</select>
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
      data-ms-placeholder="Hledat postavu…"></div>`;

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

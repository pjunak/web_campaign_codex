// ═══════════════════════════════════════════════════════════════
//  EDIT MODE — inline editing overlay for the wiki
//  Toggled by the ✏ button. When active, article pages render
//  edit forms instead of read-only views, and list pages show
//  "+ New" cards and pencil overlays on existing items.
// ═══════════════════════════════════════════════════════════════

import { Store } from './store.js';
import { EditTemplates } from './edit_templates.js';
import { Widgets } from './widgets/widgets.js';

export const EditMode = (() => {

  let _active = false;

  // ── Prefill state for new-entity creation ──────────────────────
  // Set by startNewCharacter / startNewLocation / startNewEvent and
  // consumed once by the corresponding renderXxxEditor(null). Lets
  // "+ Nová postava ve frakci" (and similar) pre-fill context fields
  // instead of sending the user to a blank form.
  let _prefill = { character: null, location: null, event: null };
  function _consumePrefill(kind) {
    const p = _prefill[kind];
    _prefill[kind] = null;
    return p || null;
  }

  // One-shot callbacks that run after a new entity has been saved.
  // Used by "+ Postava zde" to link the new character into the source
  // location's characters[] after the character is persisted.
  let _afterSave = { character: null, location: null, event: null };
  function _runAfterSave(kind, id) {
    const fn = _afterSave[kind];
    _afterSave[kind] = null;
    if (typeof fn === 'function') {
      try { fn(id); } catch (e) { console.warn(e); }
    }
  }

  function _genId(name) {
    return name.toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .substring(0, 40) || ("id_" + Date.now());
  }

  // ── Toast ──────────────────────────────────────────────────────
  function _toast(msg, ok = true) {
    let t = document.getElementById("edit-toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "edit-toast";
      t.className = "edit-toast";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.className = "edit-toast show " + (ok ? "ok" : "err");
    clearTimeout(t._tid);
    t._tid = setTimeout(() => t.classList.remove("show"), 2500);
  }

  // ── Navigate helper (forces re-render even if hash unchanged) ──
  function _navigateOrRefresh(hash) {
    if (window.location.hash === hash) {
      window.dispatchEvent(new Event("hashchange"));
    } else {
      window.location.hash = hash;
    }
  }

  // ── State ──────────────────────────────────────────────────────
  function isActive() { return _active; }

  async function toggle() {
    if (!_active) {
      try {
        const check = await fetch('/api/auth');
        if (!check.ok) {
           const pwd = prompt("Tato sekce je zabezpečena. Zadejte heslo:");
           if (pwd) {
             const res = await fetch('/api/login', {
                 method: 'POST',
                 headers: { 'Content-Type': 'application/json' },
                 body: JSON.stringify({ password: pwd })
             });
             if (!res.ok) {
                _toast("Špatné heslo", false);
                return;
             }
             _toast("Přístup povolen ✓");
           } else {
             return;
           }
        }
      } catch(e) {
         console.warn(e);
      }
    }

    _active = !_active;
    document.body.classList.toggle("edit-mode", _active);
    document.querySelectorAll(".edit-mode-toggle").forEach(btn => {
      const isBtn = btn.tagName === "BUTTON";
      if (isBtn) {
        btn.textContent = _active ? "✓ Hotovo" : "✏ Úpravy";
      } else {
        // bottom-item with icon + label spans
        const icon  = btn.querySelector(".bottom-icon");
        const label = btn.querySelector(".bottom-label");
        if (icon)  icon.textContent  = _active ? "✓" : "✏";
        if (label) label.textContent = _active ? "Hotovo" : "Úpravy";
      }
      btn.classList.toggle("active", _active);
    });
    // Re-render current page
    window.dispatchEvent(new Event("hashchange"));
  }

  // ── Dynamic fact rows ──────────────────────────────────────────
  function addDynRow(wrapperId) {
    const list = document.getElementById(wrapperId);
    if (!list) return;
    const div = document.createElement("div");
    div.innerHTML = EditTemplates.getDynRowHtml("");
    list.appendChild(div.firstElementChild);
    list.lastElementChild?.querySelector("input")?.focus();
  }

  // ── Portrait upload ────────────────────────────────────────────
  async function handlePortraitUpload(input, uid) {
    const file = input.files[0];
    if (!file) return;
    try {
      _toast("Nahrávám obrázek…");
      // Always upload to a subfolder: data/portraits/{charId}/portrait.ext
      // New characters use "_new" as a temporary charId; the server migrates
      // the file to the real subfolder when the character is first saved.
      const charId = (uid && uid !== "new") ? uid : "_new";
      const url    = await Store.uploadPortrait(file, charId);
      const preview = document.getElementById("ep-preview-" + uid);
      const hidden  = document.getElementById("ep-data-" + uid);
      // Show with cache-buster, but store the clean URL (no ?v=) in data
      if (preview) preview.innerHTML = `<img src="${url}?v=${Date.now()}" style="width:100%;height:100%;object-fit:cover;object-position:top">`;
      if (hidden)  hidden.value = url;
      _toast("Obrázek nahrán ✓");
    } catch(e) {
      _toast("Chyba při nahrávání obrázku", false);
      console.error(e);
    }
  }

  // ── Gather helpers ─────────────────────────────────────────────
  function _dynVals(id) {
    return Array.from(document.querySelectorAll(`#${id} .edit-input`))
      .map(i => i.value.trim()).filter(Boolean);
  }
  function _checkVals(id) {
    return Array.from(document.querySelectorAll(`#${id} input[type="checkbox"]:checked`))
      .map(cb => cb.value);
  }

  // ══════════════════════════════════════════════════════════════
  //  CHARACTER EDITOR
  // ══════════════════════════════════════════════════════════════
  function renderCharacterEditor(c) {
    if (!c || !c.id) {
      const pf = _consumePrefill('character');
      if (pf) return EditTemplates.renderCharacterEditor(pf);
    }
    return EditTemplates.renderCharacterEditor(c);
  }

  /** Prefill a new character's fields, then navigate to the new-character form. */
  function startNewCharacter(prefill) {
    _prefill.character = prefill || {};
    _afterSave.character = null;
    _navigateOrRefresh('#/postava/new');
  }

  /** "+ Postava zde" — create a new character and auto-link it to a location. */
  function startNewCharacterInLocation(locId) {
    _prefill.character = {};
    _afterSave.character = (newCharId) => {
      const loc = Store.getLocation(locId);
      if (!loc) return;
      const chars = [...(loc.characters || [])];
      if (!chars.includes(newCharId)) chars.push(newCharId);
      Store.saveLocation({ ...loc, characters: chars });
    };
    _navigateOrRefresh('#/postava/new');
  }

  // ── Character save / delete ────────────────────────────────────
  function saveCharacter(originalId) {
    const uid  = originalId || "new";
    const name = document.getElementById(`ef-name-${uid}`)?.value.trim();
    if (!name) { _toast("Jméno je povinné", false); return; }

    const newId   = originalId || _genId(name);
    // Preserve fields that the inline editor doesn't expose
    const existing = originalId
      ? (Store.getCharacters().find(c => c.id === originalId) || {})
      : {};

    // Resolve portrait URL: strip any ?v= cache-busters (display-only, never stored),
    // and remap the _new temp subfolder to the real charId now that we know it.
    let portrait = (document.getElementById(`ep-data-${uid}`)?.value || "").split('?')[0];
    if (portrait.startsWith('/portraits/_new/')) {
      const ext = portrait.substring(portrait.lastIndexOf('.'));
      portrait = `/portraits/${newId}/portrait${ext}`;
      // Server will physically move _new/ → newId/ when it processes the PATCH
    }

    // Delete old portrait only when moving to a genuinely different location.
    // Same-folder replacements (e.g. PNG→JPG in the same charId subfolder) are
    // cleaned up server-side during upload, so no extra delete is needed here.
    const oldPortrait = (existing.portrait || "").split('?')[0];
    if (oldPortrait && oldPortrait !== portrait && oldPortrait.startsWith('/portraits/')) {
      const oldSegment = oldPortrait.replace('/portraits/', '').split('/')[0];
      const newSegment = portrait.replace('/portraits/', '').split('/')[0];
      if (oldSegment !== newSegment) Store.deletePortrait(oldPortrait);
    }

    const ok = Store.saveCharacter({
      // Preserve all fields from existing record first, then overwrite editable ones
      ...existing,
      id:          newId,
      name,
      title:       document.getElementById(`ef-title-${uid}`)?.value.trim()        || "",
      faction:     document.getElementById(`ef-faction-${uid}`)?.value             || "neutral",
      status:      document.getElementById(`ef-status-${uid}`)?.value              || "alive",
      knowledge:   parseInt(document.getElementById(`ef-knowledge-${uid}`)?.value) || 3,
      description: document.getElementById(`ef-desc-${uid}`)?.value.trim()         || "",
      portrait,
      known:       _dynVals(`dyn-known-${uid}`),
      unknown:     _dynVals(`dyn-unknown-${uid}`),
    });
    if (ok === false) {
      _toast("⚠ Uložení selhalo – úložiště je plné.", false);
      return;
    }
    _runAfterSave('character', newId);
    _toast("✓ Postava uložena");
    _navigateOrRefresh(`#/postava/${newId}`);
  }

  function deleteCharacter(id) {
    if (!confirm("Opravdu smazat postavu? Vazby budou také odstraněny.")) return;
    Store.deleteCharacter(id); // store also clears relationships
    _toast("Postava smazána");
    window.location.hash = "#/postavy";
  }

  // ── Relationship add / update / delete ──────────────────────────
  /** Read type, dir, target, label from a relationship row by prefix */
  function _readRelRow(prefix) {
    const type   = document.getElementById(`${prefix}-type`)?.value;
    const dir    = document.getElementById(`${prefix}-dir`)?.value;
    const target = document.getElementById(`${prefix}-target`)?.value;
    const label  = document.getElementById(`${prefix}-label`)?.value.trim() || '';
    return { type, dir, target, label };
  }

  /** Build source/target based on direction relative to charId */
  function _relFromDir(charId, dir, targetId, type, label) {
    if (dir === 'both') {
      // Create two symmetric relationships
      return [
        { source: charId,   target: targetId, type, label },
        { source: targetId, target: charId,   type, label },
      ];
    }
    return [{
      source: dir === 'from' ? charId : targetId,
      target: dir === 'from' ? targetId : charId,
      type, label,
    }];
  }

  function addRelationship(charId) {
    const prefix = `rf-new-${charId}`;
    const { type, dir, target, label } = _readRelRow(prefix);
    if (!target) { _toast('Vyber cíl', false); return; }

    const rels = _relFromDir(charId, dir, target, type, label);
    rels.forEach(r => Store.saveRelationship(r));
    _toast('✓ Vazba přidána');
    _refreshRelSection(charId);
  }

  function updateRelationship(charId, idx) {
    // Get the original relationship to delete it first
    const allRels = Store.getRelationships().filter(r => r.source === charId || r.target === charId);
    const original = allRels[idx];
    if (!original) return;

    const prefix = `rf-${idx}-${charId}`;
    const { type, dir, target, label } = _readRelRow(prefix);
    if (!target) { _toast('Vyber cíl', false); return; }

    // Delete old
    Store.deleteRelationship(original.source, original.target, original.type);
    // Save new
    const rels = _relFromDir(charId, dir, target, type, label);
    rels.forEach(r => Store.saveRelationship(r));
    _toast('✓ Vazba upravena');
    _refreshRelSection(charId);
  }

  /** Called when the type dropdown changes — refreshes direction and target options */
  function relTypeChanged(charId, prefix) {
    const type = document.getElementById(`${prefix}-type`)?.value;
    if (!type) return;

    // Refresh direction options
    const dirEl = document.getElementById(`${prefix}-dir`);
    if (dirEl) {
      const currentDir = dirEl.value;
      dirEl.innerHTML = EditTemplates.getDirOptsHtml(type, currentDir);
    }
    // Re-mount the target combobox with the source matching the new type
    // (character ↔ location). The combobox's hidden input id is `${prefix}-target`,
    // which is what _readRelRow reads.
    const cfg = EditTemplates.getRelConfig()[type];
    const tgtHidden = document.getElementById(`${prefix}-target`);
    const wrap = tgtHidden?.closest('.rel-target-wrap');
    if (wrap && cfg) {
      const currentTgt = tgtHidden.value || '';
      wrap.innerHTML = EditTemplates.getTargetMountHtml(type, charId, currentTgt, prefix);
      Widgets.mountAll(wrap);
    }
    // Update placeholder on label field
    const lblEl = document.getElementById(`${prefix}-label`);
    if (lblEl && cfg) lblEl.placeholder = cfg.label;
  }

  function deleteRelationship(source, target, type, charId) {
    Store.deleteRelationship(source, target, type);
    _toast('Vazba odebrána');
    _refreshRelSection(charId);
  }

  function _refreshRelSection(charId) {
    const section = document.getElementById(`rel-section-${charId}`);
    if (section) {
      const tmp = document.createElement("div");
      tmp.innerHTML = EditTemplates.getRelSectionHtml(charId);
      const newSection = tmp.firstElementChild;
      if (newSection) {
        section.replaceWith(newSection);
        Widgets.mountAll(newSection);
      }
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  LOCATION EDITOR
  // ══════════════════════════════════════════════════════════════
  function renderLocationEditor(l) {
    if (!l || !l.id) {
      const pf = _consumePrefill('location');
      if (pf) return EditTemplates.renderLocationEditor(pf);
    }
    return EditTemplates.renderLocationEditor(l);
  }

  function startNewLocation(prefill) {
    _prefill.location = prefill || {};
    _navigateOrRefresh('#/misto/new');
  }

  function saveLocation(originalId) {
    const uid  = originalId || "new_loc";
    const name = document.getElementById(`lf-name-${uid}`)?.value.trim();
    if (!name) { _toast("Název je povinný", false); return; }
    const newId = originalId || _genId(name);
    Store.saveLocation({
      id: newId, name,
      type:        document.getElementById(`lf-type-${uid}`)?.value.trim()   || "",
      status:      document.getElementById(`lf-status-${uid}`)?.value.trim() || "",
      description: document.getElementById(`lf-desc-${uid}`)?.value.trim()   || "",
      notes:       document.getElementById(`lf-notes-${uid}`)?.value.trim()  || "",
      characters:  _checkVals(`lf-chars-${uid}`),
    });
    _runAfterSave('location', newId);
    _toast("✓ Místo uloženo");
    _navigateOrRefresh(`#/misto/${newId}`);
  }

  function deleteLocation(id) {
    if (!confirm("Opravdu smazat místo?")) return;
    Store.deleteLocation(id);
    _toast("Místo smazáno");
    window.location.hash = "#/mista";
  }

  // ══════════════════════════════════════════════════════════════
  //  EVENT EDITOR
  // ══════════════════════════════════════════════════════════════
  function renderEventEditor(e) {
    if (!e || !e.id) {
      const pf = _consumePrefill('event');
      if (pf) return EditTemplates.renderEventEditor(pf);
    }
    return EditTemplates.renderEventEditor(e);
  }

  function startNewEvent(prefill) {
    _prefill.event = prefill || {};
    _navigateOrRefresh('#/udalost/new');
  }

  function saveEvent(originalId) {
    const uid  = originalId || "new_ev";
    const name = document.getElementById(`evf-name-${uid}`)?.value.trim();
    if (!name) { _toast("Název je povinný", false); return; }
    const newId = originalId || _genId(name);
    const sittingRaw = document.getElementById(`evf-sitting-${uid}`)?.value.trim();
    const sitting    = sittingRaw ? (parseInt(sittingRaw) || null) : null;
    // Preserve fields not exposed in the editor
    const existingEv = originalId ? (Store.getEvent(originalId) || {}) : {};
    Store.saveEvent({
      ...existingEv,
      id: newId, name,
      order:       parseInt(document.getElementById(`evf-order-${uid}`)?.value)  || 99,
      sitting,
      short:       document.getElementById(`evf-short-${uid}`)?.value.trim()     || "",
      description: document.getElementById(`evf-desc-${uid}`)?.value.trim()      || "",
      characters:  _checkVals(`evf-chars-${uid}`),
      locations:   _checkVals(`evf-locs-${uid}`),
      consequence: document.getElementById(`evf-cons-${uid}`)?.value             || "",
    });
    _runAfterSave('event', newId);
    _toast("✓ Událost uložena");
    _navigateOrRefresh(`#/udalost/${newId}`);
  }

  function deleteEvent(id) {
    if (!confirm("Opravdu smazat událost?")) return;
    Store.deleteEvent(id);
    _toast("Událost smazána");
    window.location.hash = "#/udalosti";
  }

  // ══════════════════════════════════════════════════════════════
  //  MYSTERY EDITOR
  // ══════════════════════════════════════════════════════════════
  function renderMysteryEditor(m) {
    return EditTemplates.renderMysteryEditor(m);
  }

  function saveMystery(originalId) {
    const uid  = originalId || "new_mys";
    const name = document.getElementById(`mf-name-${uid}`)?.value.trim();
    if (!name) { _toast("Název je povinný", false); return; }
    const newId = originalId || _genId(name);
    // Preserve fields that the inline editor doesn't expose (questions, clues, etc.)
    const existing = originalId
      ? (Store.getMysteries().find(m => m.id === originalId) || {})
      : {};
    Store.saveMystery({
      ...existing,
      id: newId, name,
      priority:    document.getElementById(`mf-pri-${uid}`)?.value         || "střední",
      description: document.getElementById(`mf-desc-${uid}`)?.value.trim() || "",
      characters:  _checkVals(`mf-chars-${uid}`),
    });
    _toast("✓ Záhada uložena");
    _navigateOrRefresh(`#/zahada/${newId}`);
  }

  function deleteMystery(id) {
    if (!confirm("Opravdu smazat záhadu?")) return;
    Store.deleteMystery(id);
    _toast("Záhada smazána");
    window.location.hash = "#/zahady";
  }

  // ══════════════════════════════════════════════════════════════
  //  FACTION EDITOR
  // ══════════════════════════════════════════════════════════════
  function renderFactionEditor(f, facId) {
    return EditTemplates.renderFactionEditor(f, facId);
  }

  function addRankChain(containerId, uid) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const ci = container.querySelectorAll('.rank-chain-edit').length;
    const div = document.createElement('div');
    div.innerHTML = EditTemplates.getChainEditHtml({ id:'', name:'', ranks:[] }, uid, 'n' + ci);
    container.appendChild(div.firstElementChild);
    container.lastElementChild?.querySelector('input')?.focus();
  }

  function addRankRow(listId) {
    const list = document.getElementById(listId);
    if (!list) return;
    const div = document.createElement('div');
    div.innerHTML = EditTemplates.getDynRowHtml("");
    list.appendChild(div.firstElementChild);
    list.lastElementChild?.querySelector('input')?.focus();
  }

  function saveFaction(originalId) {
    const uid  = (originalId || "new_fac").replace(/[^a-z0-9_]/gi, "_");
    const name = document.getElementById(`ff-name-${uid}`)?.value.trim();
    if (!name) { _toast("Název je povinný", false); return; }
    const newId     = originalId || _genId(name);
    const color     = document.getElementById(`ff-color-text-${uid}`)?.value.trim() || "#555555";
    const textColor = document.getElementById(`ff-textcolor-text-${uid}`)?.value.trim() || "#E0E0E0";
    const badge     = document.getElementById(`ff-badge-${uid}`)?.value.trim() || "⚐";
    const desc      = document.getElementById(`ff-desc-${uid}`)?.value.trim() || "";

    const chainEls  = document.querySelectorAll(`#chains-${uid} .rank-chain-edit`);
    const rankChains = Array.from(chainEls).map(el => {
      const chainName = el.querySelector('input[placeholder="Název řetězce"]')?.value.trim() || "";
      const chainId   = el.dataset.chainId || _genId(chainName) || ("chain_" + Date.now());
      const rankInputs = el.querySelectorAll('.rank-ranks-list .edit-input');
      const ranks = Array.from(rankInputs).map(i => i.value.trim()).filter(Boolean);
      return { id: chainId, name: chainName, ranks };
    }).filter(ch => ch.name);

    // Preserve any fields not in the editor (e.g., if faction had extra properties)
    const existing = originalId ? (Store.getFaction(originalId) || {}) : {};
    Store.saveFaction(newId, { ...existing, name, color, textColor, badge, description: desc, rankChains });
    _toast("✓ Frakce uložena");
    _navigateOrRefresh(`#/frakce/${newId}`);
  }

  function deleteFaction(id) {
    if (!confirm("Opravdu smazat frakci? Postavy ji budou mít stále přiřazenou dokud ji ručně nezměníte.")) return;
    Store.deleteFaction(id);
    _toast("Frakce smazána");
    window.location.hash = "#/frakce";
  }

  // ── Public API ─────────────────────────────────────────────────
  return {
    isActive, toggle,
    addDynRow, handlePortraitUpload,
    addRankChain, addRankRow,
    saveCharacter, deleteCharacter,
    addRelationship, updateRelationship, deleteRelationship, relTypeChanged,
    saveLocation, deleteLocation,
    saveEvent, deleteEvent,
    saveMystery, deleteMystery,
    saveFaction, deleteFaction,
    renderCharacterEditor,
    renderLocationEditor,
    renderEventEditor,
    renderMysteryEditor,
    renderFactionEditor,
    startNewCharacter, startNewLocation, startNewEvent,
    startNewCharacterInLocation,
  };

})();

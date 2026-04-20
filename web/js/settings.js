// ═══════════════════════════════════════════════════════════════
//  SETTINGS PAGE — user-editable enums at /nastaveni.
//  Left column lists categories, right column edits the selected
//  one. Delete-with-usage shows a modal that lets the GM choose
//  between replace-with, force-delete, or cancel. Orphan references
//  are handled gracefully by resolveEnum() in consumers.
// ═══════════════════════════════════════════════════════════════

import { Store } from './store.js';
import { esc } from './utils.js';

export const Settings = (() => {

  // Shape of each category: which fields to expose in the editor form.
  // `priority` is only meaningful for pinTypes. `icon` / `color` are
  // shown as side-by-side inputs when declared.
  const CATEGORIES = [
    { id: 'relationshipTypes', label: 'Vazby mezi postavami', icon: '🔗',
      fields: ['label', 'color', 'style'] },
    { id: 'genders',           label: 'Pohlaví',              icon: '⚥',
      fields: ['label'] },
    { id: 'pinTypes',          label: 'Typy míst',             icon: '📍',
      fields: ['label', 'icon', 'color', 'priority'] },
    { id: 'characterStatuses', label: 'Stavy postav',          icon: '●',
      fields: ['label', 'icon', 'color'] },
    { id: 'artifactStates',    label: 'Stavy artefaktů',       icon: '🗝',
      fields: ['label', 'icon', 'color'] },
    { id: 'eventPriorities',   label: 'Priority událostí',     icon: '⚑',
      fields: ['label', 'color'] },
    { id: 'mapStatuses',       label: 'Stavy na mapě',         icon: '🗺',
      fields: ['label', 'bg', 'fg', 'labelColor'] },
  ];

  let _activeCat = CATEGORIES[0].id;
  let _editingId = null;  // id being edited inline, or '__new__' for add form

  // ── Render ───────────────────────────────────────────────────
  function render() {
    const el = document.getElementById('main-content');
    if (!el) return;
    el.innerHTML = _pageHtml();
    el.scrollTop = 0;
    window.scrollTo(0, 0);
  }

  function _pageHtml() {
    return `
      <div class="settings-page">
        <div class="page-header"><h1>⚙ Nastavení</h1>
          <div class="subtitle">Číselníky: vazby, pohlaví, typy míst, stavy…</div>
        </div>
        <div class="settings-shell">
          <nav class="settings-tabs">
            ${CATEGORIES.map(c => `
              <button type="button" class="settings-tab ${c.id===_activeCat?'is-active':''}"
                onclick="Settings.selectCategory('${c.id}')">
                <span class="settings-tab-icon">${c.icon}</span>
                <span class="settings-tab-label">${esc(c.label)}</span>
                <span class="settings-tab-count">${Store.getEnum(c.id).length}</span>
              </button>`).join('')}
          </nav>
          <section class="settings-editor">${_editorHtml()}</section>
        </div>
      </div>`;
  }

  function _editorHtml() {
    const cat = CATEGORIES.find(c => c.id === _activeCat);
    const items = Store.getEnum(_activeCat);
    const rows = items.map(it => _rowHtml(cat, it)).join('');
    const addForm = _editingId === '__new__'
      ? _formHtml(cat, { id:'', label:'', color:'#888', icon:'', priority:3, style:'solid' }, true)
      : '';
    return `
      <div class="settings-editor-head">
        <h2>${cat.icon} ${esc(cat.label)}</h2>
        <div class="settings-editor-actions">
          <button type="button" class="inline-create-btn"
            onclick="Settings.startNew()">＋ Přidat</button>
          <button type="button" class="inline-create-btn"
            title="Přidat zpět chybějící výchozí položky"
            onclick="Settings.resetDefaults()">↺ Doplnit výchozí</button>
        </div>
      </div>
      ${addForm}
      <div class="settings-rows">
        ${rows || '<div class="settings-empty">Tato kategorie je prázdná.</div>'}
      </div>
      <p class="settings-hint">
        Smazání položky, která je používaná, nabídne možnost nahradit ji
        jinou položkou nebo odstranit i tak (chybějící odkazy se vykreslují
        s ⚠ varováním, nic se nerozbije).
      </p>`;
  }

  function _rowHtml(cat, item) {
    if (_editingId === item.id) return _formHtml(cat, item, false);
    const usageCount = Store.findEnumUsages(_activeCat, item.id).length;
    const swatch = item.color
      ? `<span class="settings-swatch" style="background:${esc(item.color)}"></span>` : '';
    return `
      <div class="settings-row">
        <span class="settings-row-icon">${esc(item.icon || item.label?.[0] || '·')}</span>
        <span class="settings-row-label">${esc(item.label || item.id)}</span>
        ${swatch}
        <code class="settings-row-id">${esc(item.id)}</code>
        <span class="settings-row-usage" title="Použitích">${usageCount > 0 ? usageCount + '×' : '–'}</span>
        <div class="settings-row-actions">
          <button type="button" class="settings-btn-edit"
            onclick="Settings.startEdit('${esc(item.id)}')">✏</button>
          <button type="button" class="settings-btn-del"
            onclick="Settings.requestDelete('${esc(item.id)}')">🗑</button>
        </div>
      </div>`;
  }

  function _formHtml(cat, item, isNew) {
    const uid = isNew ? 'new' : esc(item.id);
    const field = (name, placeholder, type='text') => {
      const val = item[name] == null ? '' : String(item[name]);
      return `
        <label class="settings-field">
          <span class="settings-field-label">${esc(_fieldLabel(name))}</span>
          <input class="edit-input" type="${type}" id="sf-${uid}-${name}"
            value="${esc(val)}" placeholder="${esc(placeholder || '')}">
        </label>`;
    };
    const colorField = (name) => `
      <label class="settings-field">
        <span class="settings-field-label">${esc(_fieldLabel(name))}</span>
        <input class="edit-input" type="color" id="sf-${uid}-${name}"
          value="${esc(item[name] || '#888888')}">
      </label>`;
    const styleField = () => `
      <label class="settings-field">
        <span class="settings-field-label">Styl čáry</span>
        <select class="edit-select" id="sf-${uid}-style">
          ${['solid','dashed','dotted'].map(s =>
            `<option value="${s}" ${item.style===s?'selected':''}>${s}</option>`).join('')}
        </select>
      </label>`;
    const priorityField = () => `
      <label class="settings-field">
        <span class="settings-field-label">Priorita (1 vždy, 3 detail)</span>
        <select class="edit-select" id="sf-${uid}-priority">
          ${[1,2,3].map(n => `<option value="${n}" ${Number(item.priority)===n?'selected':''}>${n}</option>`).join('')}
        </select>
      </label>`;

    const inputs = (cat.fields || []).map(name => {
      if (name === 'color' || name === 'bg' || name === 'fg' || name === 'labelColor') return colorField(name);
      if (name === 'style')                                                            return styleField();
      if (name === 'priority')                                                         return priorityField();
      return field(name, name === 'icon' ? 'Emoji nebo znak' : 'Text');
    }).join('');

    return `
      <div class="settings-form">
        <div class="settings-form-row">
          ${isNew ? `
            <label class="settings-field">
              <span class="settings-field-label">ID (volitelně, vygeneruje se z názvu)</span>
              <input class="edit-input" id="sf-${uid}-id" placeholder="např. ally">
            </label>` : `
            <div class="settings-field settings-field-readonly">
              <span class="settings-field-label">ID</span>
              <code>${esc(item.id)}</code>
            </div>`}
          ${inputs}
        </div>
        <div class="settings-form-actions">
          <button type="button" class="edit-save-btn"
            onclick="Settings.commit('${uid}', ${isNew})">💾 Uložit</button>
          <button type="button" class="inline-create-btn"
            onclick="Settings.cancelEdit()">Zrušit</button>
        </div>
      </div>`;
  }

  function _fieldLabel(name) {
    return {
      label: 'Název', icon: 'Ikona', color: 'Barva',
      style: 'Styl', priority: 'Priorita',
      bg: 'Pozadí', fg: 'Popředí', labelColor: 'Barva textu',
    }[name] || name;
  }

  // ── Public commands (called from inline onclick handlers) ────
  function selectCategory(cat) {
    _activeCat = cat;
    _editingId = null;
    render();
  }

  function startNew() {
    _editingId = '__new__';
    render();
  }

  function startEdit(id) {
    _editingId = id;
    render();
  }

  function cancelEdit() {
    _editingId = null;
    render();
  }

  function commit(uid, isNew) {
    const cat = CATEGORIES.find(c => c.id === _activeCat);
    const getVal = (name) => {
      const el = document.getElementById(`sf-${uid}-${name}`);
      return el ? el.value : '';
    };
    const existing = isNew ? null : Store.getEnum(_activeCat).find(x => x.id === uid);
    const label = getVal('label').trim();
    if (!label) { _flash('Název je povinný', false); return; }
    let id = isNew ? (getVal('id').trim() || _slug(label)) : uid;
    if (!id) id = _slug(label);
    if (isNew && Store.getEnum(_activeCat).some(x => x.id === id)) {
      _flash(`ID '${id}' už existuje — zvol jiné nebo nech vygenerovat`, false);
      return;
    }
    const item = { ...(existing || {}), id, label };
    for (const f of cat.fields) {
      const v = getVal(f);
      if (v !== '' && v != null) {
        item[f] = (f === 'priority') ? Number(v) : v;
      }
    }
    Store.saveEnumItem(_activeCat, item);
    _editingId = null;
    render();
    _flash(isNew ? `Položka "${label}" vytvořena` : `Položka "${label}" upravena`);
  }

  function requestDelete(id) {
    const usages = Store.findEnumUsages(_activeCat, id);
    const item = Store.getEnum(_activeCat).find(x => x.id === id);
    if (!usages.length) {
      if (!confirm(`Smazat "${item?.label || id}"?`)) return;
      Store.deleteEnumItem(_activeCat, id);
      render();
      _flash('Smazáno');
      return;
    }
    _openDeleteModal(id, item, usages);
  }

  function resetDefaults() {
    Store.resetEnumCategory(_activeCat);
    render();
    _flash('Výchozí položky doplněny');
  }

  // ── Delete-with-usage modal ──────────────────────────────────
  function _openDeleteModal(id, item, usages) {
    const cat = _activeCat;
    const others = Store.getEnum(cat).filter(x => x.id !== id);
    const usageLinks = usages.slice(0, 20).map(u => `
      <li><a href="#/${_routeForCollection(u.collection)}/${u.id}">${esc(u.name)}</a></li>`).join('');
    const overflow = usages.length > 20 ? `<li>…a dalších ${usages.length - 20}</li>` : '';

    let root = document.getElementById('settings-del-modal');
    if (root) root.remove();
    root = document.createElement('div');
    root.id = 'settings-del-modal';
    root.className = 'settings-modal';
    root.innerHTML = `
      <div class="settings-modal-backdrop" data-dismiss></div>
      <div class="settings-modal-panel" role="dialog" aria-modal="true">
        <div class="settings-modal-title">Smazat "${esc(item?.label || id)}"?</div>
        <div class="settings-modal-body">
          <p>Tento záznam je používán <strong>${usages.length}×</strong>:</p>
          <ul class="settings-modal-usages">${usageLinks}${overflow}</ul>
          <div class="settings-modal-choice">
            <label class="settings-field">
              <span class="settings-field-label">Nahradit za…</span>
              <select class="edit-select" id="sdm-replace">
                <option value="">— nevybráno —</option>
                ${others.map(o => `<option value="${esc(o.id)}">${esc(o.label)}</option>`).join('')}
              </select>
            </label>
          </div>
        </div>
        <div class="settings-modal-actions">
          <button type="button" class="edit-save-btn"
            onclick="Settings.commitDelete('${esc(id)}','replace')">Nahradit &amp; smazat</button>
          <button type="button" class="edit-delete-btn"
            onclick="Settings.commitDelete('${esc(id)}','force')">Smazat i tak</button>
          <button type="button" class="inline-create-btn"
            onclick="Settings.closeModal()">Zrušit</button>
        </div>
      </div>`;
    document.body.appendChild(root);
    root.querySelector('.settings-modal-backdrop')
        .addEventListener('click', () => root.remove());
  }

  function commitDelete(id, mode) {
    if (mode === 'replace') {
      const replaceWith = document.getElementById('sdm-replace')?.value || '';
      if (!replaceWith) { _flash('Vyber, za co nahradit', false); return; }
      const res = Store.deleteEnumItem(_activeCat, id, { replaceWith });
      closeModal();
      render();
      _flash(`Nahrazeno v ${res.usages.length} záznamech a smazáno`);
    } else if (mode === 'force') {
      const res = Store.deleteEnumItem(_activeCat, id, { force: true });
      closeModal();
      render();
      _flash(`Smazáno (${res.usages.length} odkazů zůstalo jako siroty)`);
    }
  }

  function closeModal() {
    document.getElementById('settings-del-modal')?.remove();
  }

  // ── Helpers ──────────────────────────────────────────────────
  function _slug(s) {
    return String(s).toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 40) || 'e';
  }

  function _routeForCollection(c) {
    return ({
      characters:'postava', locations:'misto', events:'udalost',
      mysteries:'zahada', artifacts:'artefakt',
      relationships:'postava',  // rels don't have their own page
    })[c] || c;
  }

  // Route notifications through EditMode's toast (same visual style
   // as save/delete feedback across the rest of the app).
  function _flash(msg, ok = true) {
    if (window.EditMode && typeof window.EditMode.toast === 'function') {
      window.EditMode.toast(msg, ok);
    } else {
      console.log('[settings]', msg);
    }
  }

  return {
    render,
    selectCategory, startNew, startEdit, cancelEdit,
    commit, requestDelete, commitDelete, closeModal,
    resetDefaults,
  };
})();

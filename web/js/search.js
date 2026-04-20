// ═══════════════════════════════════════════════════════════════
//  GLOBAL SEARCH — Ctrl+K palette across every collection.
//  Driven by Store.searchAll + factions. Keyboard-first: ↑↓ move,
//  Enter jumps, Esc closes. Opens a single singleton overlay built
//  lazily on first use; no preview_* dependency — pure DOM.
// ═══════════════════════════════════════════════════════════════

import { Store } from './store.js';
import { esc, norm, debounce } from './utils.js';

export const GlobalSearch = (() => {

  let _root     = null;     // the .gs-modal DOM node (lazy)
  let _input    = null;
  let _results  = null;
  let _items    = [];       // flattened { kind, id, name, subtitle, route }
  let _idx      = 0;        // keyboard selection index

  const KIND_META = {
    postava:  { icon: '👤', label: 'Postavy'   },
    misto:    { icon: '📍', label: 'Místa'     },
    udalost:  { icon: '⏳', label: 'Události'  },
    zahada:   { icon: '❓', label: 'Záhady'    },
    frakce:   { icon: '⬡',  label: 'Frakce'    },
    druh:     { icon: '🧬', label: 'Druhy'     },
    buh:      { icon: '✨', label: 'Panteon'   },
    artefakt: { icon: '🗝', label: 'Artefakty' },
  };

  function _build() {
    if (_root) return;
    _root = document.createElement('div');
    _root.className = 'gs-modal';
    _root.hidden = true;
    _root.innerHTML = `
      <div class="gs-backdrop" data-dismiss></div>
      <div class="gs-panel" role="dialog" aria-modal="true" aria-label="Globální vyhledávání">
        <input class="gs-input" type="text" placeholder="Hledat ve všem…" autocomplete="off" spellcheck="false">
        <div class="gs-results" role="listbox"></div>
        <div class="gs-hint">↑↓ procházet · ↵ otevřít · Esc zavřít</div>
      </div>`;
    document.body.appendChild(_root);
    _input   = _root.querySelector('.gs-input');
    _results = _root.querySelector('.gs-results');

    _input.addEventListener('input', debounce(() => _updateResults(_input.value), 80));
    _input.addEventListener('keydown', _onKey);
    _root.addEventListener('click', (ev) => {
      if (ev.target.dataset.dismiss !== undefined) close();
      const row = ev.target.closest('.gs-row');
      if (row) _pick(parseInt(row.dataset.i, 10));
    });
  }

  function _onKey(ev) {
    if (ev.key === 'Escape') { ev.preventDefault(); close(); return; }
    if (ev.key === 'ArrowDown') { ev.preventDefault(); _move(+1); return; }
    if (ev.key === 'ArrowUp')   { ev.preventDefault(); _move(-1); return; }
    if (ev.key === 'Enter')     { ev.preventDefault(); _pick(_idx); return; }
  }

  function _move(d) {
    if (!_items.length) return;
    _idx = (_idx + d + _items.length) % _items.length;
    _renderResults(_input.value);
    const active = _results.querySelector('.gs-row.is-active');
    if (active) active.scrollIntoView({ block: 'nearest' });
  }

  function _pick(i) {
    const item = _items[i];
    if (!item) return;
    close();
    window.location.hash = item.route;
  }

  function _updateResults(q) {
    const query = String(q || '').trim();
    if (!query) { _items = _recentSuggestions(); _renderResults(query); return; }
    // Store.searchAll() returns per-kind arrays of entities.
    const all = Store.searchAll(query) || {};
    const out = [];
    const pushKind = (kind, route, list, sub) => {
      for (const e of list || []) {
        out.push({
          kind, id: e.id, name: e.name || e.id,
          subtitle: sub ? sub(e) : '',
          route: `#/${route}/${e.id}`,
        });
      }
    };
    pushKind('postava',  'postava',  all.characters, e => e.title ? esc(e.title) : '');
    pushKind('misto',    'misto',    all.locations,  e => [e.type, e.region].filter(Boolean).map(esc).join(' · '));
    pushKind('udalost',  'udalost',  all.events,     e => e.sitting ? `Sezení ${e.sitting}` : '');
    pushKind('zahada',   'zahada',   all.mysteries,  e => e.priority ? `Priorita: ${e.priority}` : '');
    pushKind('druh',     'druh',     all.species);
    pushKind('buh',      'buh',      all.pantheon,   e => e.domain ? esc(e.domain) : '');
    pushKind('artefakt', 'artefakt', all.artifacts);
    // Factions aren't in searchAll — scan manually.
    const qn = norm(query);
    const factions = Store.getFactions ? Store.getFactions() : {};
    for (const [id, f] of Object.entries(factions)) {
      if (norm(f.name).includes(qn) || norm(id).includes(qn)) {
        out.push({ kind:'frakce', id, name: f.name, subtitle: '', route: `#/frakce/${id}` });
      }
    }
    _items = out.slice(0, 50);
    _idx = 0;
    _renderResults(query);
  }

  function _recentSuggestions() {
    if (!Store.getRecentActivity) return [];
    return Store.getRecentActivity(8).map(e => ({
      kind: e.kind, id: e.id, name: e.name,
      subtitle: 'Nedávno upraveno',
      route: e.route === '#/frakce' ? `${e.route}/${e.id}` : `${e.route}/${e.id}`,
    }));
  }

  function _renderResults(query) {
    if (!_items.length) {
      _results.innerHTML = query
        ? `<div class="gs-empty">Nic nenalezeno</div>`
        : `<div class="gs-empty">Začni psát — nebo vyber z nedávných úprav…</div>`;
      return;
    }
    // Group by kind, preserving order of first appearance.
    const groups = new Map();
    _items.forEach((it, i) => {
      if (!groups.has(it.kind)) groups.set(it.kind, []);
      groups.get(it.kind).push({ ...it, i });
    });
    let html = '';
    for (const [kind, list] of groups) {
      const meta = KIND_META[kind] || { icon: '•', label: kind };
      html += `<div class="gs-group"><div class="gs-group-title">${meta.icon} ${esc(meta.label)}</div>`;
      for (const it of list) {
        const active = it.i === _idx ? ' is-active' : '';
        html += `
          <div class="gs-row${active}" role="option" data-i="${it.i}">
            <div class="gs-row-name">${esc(it.name)}</div>
            ${it.subtitle ? `<div class="gs-row-sub">${it.subtitle}</div>` : ''}
          </div>`;
      }
      html += `</div>`;
    }
    _results.innerHTML = html;
  }

  function open() {
    _build();
    _root.hidden = false;
    _input.value = '';
    _items = _recentSuggestions();
    _idx = 0;
    _renderResults('');
    setTimeout(() => _input.focus(), 0);
  }

  function close() {
    if (!_root) return;
    _root.hidden = true;
  }

  function isOpen() { return _root && !_root.hidden; }

  // ── Global keybinding: Ctrl+K / Cmd+K ────────────────────────
  document.addEventListener('keydown', (ev) => {
    const key = ev.key.toLowerCase();
    if (!(ev.ctrlKey || ev.metaKey) || ev.altKey || ev.shiftKey) return;
    if (key !== 'k') return;
    ev.preventDefault();
    isOpen() ? close() : open();
  });

  return { open, close, isOpen };
})();

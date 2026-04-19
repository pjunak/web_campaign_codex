// ═══════════════════════════════════════════════════════════════
//  TIMELINE — Lineární časová osa
//  Horizontálně scrollovatelná osa s informačními oblaky.
//  Každý event je oblak nad/pod osou. Sezení jsou oddělena
//  svislými oddělovači. Události mimo sezení jdou do "Minulosti".
// ═══════════════════════════════════════════════════════════════

import { Store } from './store.js';
import { EditMode } from './editmode.js';

// Flat render order of events. Populated on every render() and consumed by
// the drag-drop handler to rebuild sittings/orders after a reorder.
let _flatList = [];
let _draggingId = null;

export const Timeline = (() => {

  // ── Layout constants ──────────────────────────────────────────
  const SLOT_W     = 230;   // horizontal space per event (px)
  const DIV_W      = 110;   // width of a session-divider zone
  const PAD_LEFT   = 80;    // left padding before first event
  const PAD_RIGHT  = 100;   // trailing right padding
  const CANVAS_H   = 680;   // total canvas height (px)
  const AXIS_Y     = 330;   // Y of axis line from top of canvas
  const STEM_H     = 52;    // stem height (axis dot → cloud edge)
  const CLOUD_W    = 210;   // cloud card width (px)
  const CLOUD_MAX_H_ABOVE = 240; // max space allocated above axis for clouds

  // ── Helpers ───────────────────────────────────────────────────
  function _esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function _factionColor(id) { return Store.getFactions()[id]?.color || '#8B6914'; }

  // Primary character faction colour for an event, or gold fallback
  function _eventAccentColor(e) {
    const chars = Store.getCharacters();
    for (const cid of (e.characters || [])) {
      const c = chars.find(x => x.id === cid);
      if (c && c.faction && c.faction !== 'neutral') return _factionColor(c.faction);
    }
    return '#8B6914';
  }

  // Recompute `sitting` + `order` across all events after a drag.
  // Given the ordered list (post-drop, with the moved event in its new slot
  // and its sitting already overridden), re-number `order` as 1,2,3 per
  // sitting group. Every event whose sitting or order actually changed is
  // persisted via Store.saveEvent.
  function _commitDragReorder(orderedList) {
    const perSitting = new Map();
    const writes = [];
    orderedList.forEach(e => {
      const key = e.sitting ?? '__past__';
      const idx = (perSitting.get(key) ?? 0) + 1;
      perSitting.set(key, idx);
      const existing = Store.getEvent(e.id);
      if (!existing) return;
      if (existing.sitting !== e.sitting || existing.order !== idx) {
        writes.push({ ...existing, sitting: e.sitting, order: idx });
      }
    });
    writes.forEach(w => Store.saveEvent(w));
    return writes.length > 0;
  }

  // Build the HTML for one event cloud card
  function _cloudHTML(e) {
    const chars   = Store.getCharacters();
    const locs    = Store.getLocations();

    const charNames = (e.characters || []).slice(0, 4).map(id => {
      const c = chars.find(x => x.id === id);
      return c ? _esc(c.name) : _esc(id);
    });
    const charMore = (e.characters || []).length > 4
      ? ` <span class="tl-more">+${(e.characters||[]).length - 4}</span>` : '';

    const locNames = (e.locations || []).map(id => {
      const l = locs.find(x => x.id === id);
      return l ? _esc(l.name) : _esc(id);
    });

    const sitting = e.sitting
      ? `<span class="tl-strip-sitting">Sezení ${e.sitting}</span>`
      : `<span class="tl-strip-past">Minulost</span>`;

    return `
      <div class="tl-cloud" data-id="${e.id}" tabindex="0" role="button"
           aria-label="${_esc(e.name)}" style="--tc:${_eventAccentColor(e)}">
        <div class="tl-cloud-strip">${sitting}</div>
        <div class="tl-cloud-name">${_esc(e.name)}</div>
        <div class="tl-cloud-divider"></div>
        ${e.short ? `<div class="tl-cloud-desc">${_esc(e.short)}</div>` : ''}
        ${charNames.length ? `<div class="tl-cloud-chars">👤 ${charNames.join(', ')}${charMore}</div>` : ''}
        ${locNames.length  ? `<div class="tl-cloud-loc">📍 ${locNames.join(' → ')}</div>` : ''}
      </div>`;
  }

  // ── Place one event on the canvas ─────────────────────────────
  function _placeEvent(canvas, e, x, globalIdx) {
    const above = globalIdx % 2 === 0;
    const midX  = x + SLOT_W / 2;

    // Axis dot
    const dot = document.createElement('div');
    dot.className = 'tl-dot' + (e.sitting ? '' : ' tl-dot-past');
    dot.style.left = (midX - 6) + 'px';
    dot.style.top  = (AXIS_Y - 6) + 'px';
    canvas.appendChild(dot);

    // Stem (vertical line from dot to cloud)
    const stem = document.createElement('div');
    stem.className = 'tl-stem' + (e.sitting ? '' : ' tl-stem-past');
    stem.style.left   = midX + 'px';
    stem.style.height = STEM_H + 'px';
    if (above) {
      stem.style.top = (AXIS_Y - STEM_H) + 'px';
    } else {
      stem.style.top = AXIS_Y + 'px';
    }
    canvas.appendChild(stem);

    // Cloud wrapper
    const wrapper = document.createElement('div');
    wrapper.className = 'tl-cloud-wrapper ' + (above ? 'tl-above' : 'tl-below');
    wrapper.style.left  = (midX - CLOUD_W / 2) + 'px';
    if (above) {
      // bottom of wrapper = top of stem (AXIS_Y - STEM_H)
      // canvas height is CANVAS_H, so bottom-offset = CANVAS_H - (AXIS_Y - STEM_H)
      wrapper.style.bottom = (CANVAS_H - AXIS_Y + STEM_H) + 'px';
      wrapper.style.maxHeight = (AXIS_Y - STEM_H - 20) + 'px';
    } else {
      wrapper.style.top = (AXIS_Y + STEM_H) + 'px';
      wrapper.style.maxHeight = (CANVAS_H - AXIS_Y - STEM_H - 20) + 'px';
    }
    wrapper.style.width = CLOUD_W + 'px';
    wrapper.innerHTML = _cloudHTML(e);
    canvas.appendChild(wrapper);

    const cloud = wrapper.querySelector('.tl-cloud');

    // Click to navigate. Suppressed if a drag just finished (the drop
    // target also receives a synthetic click on some browsers).
    cloud.addEventListener('click', () => {
      if (cloud.dataset.tlJustDragged === '1') {
        delete cloud.dataset.tlJustDragged;
        return;
      }
      window.location.hash = `#/udalost/${e.id}`;
    });
    cloud.addEventListener('keydown', ev => {
      if (ev.key === 'Enter' || ev.key === ' ') window.location.hash = `#/udalost/${e.id}`;
    });

    // Drag-drop reorder (edit mode only).
    if (EditMode.isActive()) {
      cloud.setAttribute('draggable', 'true');
      cloud.addEventListener('dragstart', ev => {
        _draggingId = e.id;
        cloud.classList.add('tl-drag-src');
        // Some browsers need data on the transfer to start a drag.
        try { ev.dataTransfer.setData('text/plain', e.id); } catch {}
        ev.dataTransfer.effectAllowed = 'move';
      });
      cloud.addEventListener('dragend', () => {
        cloud.classList.remove('tl-drag-src');
        wrapper.classList.remove('tl-drop-left', 'tl-drop-right');
        _draggingId = null;
        cloud.dataset.tlJustDragged = '1';
        setTimeout(() => { delete cloud.dataset.tlJustDragged; }, 0);
      });
      wrapper.addEventListener('dragover', ev => {
        if (!_draggingId || _draggingId === e.id) return;
        ev.preventDefault();
        ev.dataTransfer.dropEffect = 'move';
        const rect = wrapper.getBoundingClientRect();
        const before = (ev.clientX - rect.left) < rect.width / 2;
        wrapper.classList.toggle('tl-drop-left', before);
        wrapper.classList.toggle('tl-drop-right', !before);
      });
      wrapper.addEventListener('dragleave', () => {
        wrapper.classList.remove('tl-drop-left', 'tl-drop-right');
      });
      wrapper.addEventListener('drop', ev => {
        ev.preventDefault();
        wrapper.classList.remove('tl-drop-left', 'tl-drop-right');
        const srcId = _draggingId;
        _draggingId = null;
        if (!srcId || srcId === e.id) return;
        const rect = wrapper.getBoundingClientRect();
        const before = (ev.clientX - rect.left) < rect.width / 2;
        _handleDrop(srcId, e.id, before);
      });
    }
  }

  // Rebuild the flat list with `srcId` inserted before/after `tgtId` and the
  // dragged event's sitting overridden to the target's. Then persist and
  // re-render.
  function _handleDrop(srcId, tgtId, insertBefore) {
    const list = _flatList.slice();
    const srcIdx = list.findIndex(x => x.id === srcId);
    const tgtIdx = list.findIndex(x => x.id === tgtId);
    if (srcIdx < 0 || tgtIdx < 0) return;
    const moved = { ...list[srcIdx], sitting: list[tgtIdx].sitting };
    list.splice(srcIdx, 1);
    const reTgtIdx = list.findIndex(x => x.id === tgtId);
    const insertAt = insertBefore ? reTgtIdx : reTgtIdx + 1;
    list.splice(insertAt, 0, moved);
    if (_commitDragReorder(list)) {
      // Store.saveEvent schedules a write; SSE will re-render, but do a
      // local refresh too so the DM sees the reorder immediately without
      // waiting for the round-trip.
      render();
    }
  }

  // ── Place a session divider ───────────────────────────────────
  function _placeDivider(canvas, x) {
    const bar = document.createElement('div');
    bar.className = 'tl-divider-bar';
    bar.style.left = (x + DIV_W / 2 - 1) + 'px';
    bar.style.top  = (AXIS_Y - 70) + 'px';
    bar.style.height = '140px';
    canvas.appendChild(bar);
  }

  // ── Place a section bracket label ─────────────────────────────
  function _placeSectionBracket(canvas, startX, endX, text, isPast) {
    const bracket = document.createElement('div');
    bracket.className = 'tl-section-bracket' + (isPast ? ' tl-section-past' : '');
    bracket.style.left  = startX + 'px';
    bracket.style.width = (endX - startX) + 'px';
    bracket.style.top   = (AXIS_Y + 16) + 'px';
    bracket.innerHTML   = `<span class="tl-section-text">${_esc(text)}</span>`;
    canvas.appendChild(bracket);
  }

  // ── Main render ───────────────────────────────────────────────
  function render() {
    // Sort: past events first, then by sitting, then by order within sitting
    const allEvents = [...Store.getEvents()].sort((a, b) => {
      const sA = a.sitting ?? 0;
      const sB = b.sitting ?? 0;
      if (sA !== sB) return sA - sB;
      return (a.order ?? 0) - (b.order ?? 0);
    });

    const pastEvents = allEvents.filter(e => !e.sitting);
    const maxSitting = allEvents.reduce((m, e) => Math.max(m, e.sitting ?? 0), 0);
    _flatList = allEvents;

    // Build the shell HTML
    document.getElementById('main-content').style.display = '';
    document.getElementById('main-content').innerHTML = `
      <div class="tl-shell">
        <div class="tl-toolbar">
          <div class="tl-title">⏳ Časová Osa</div>
          <span class="tl-hint">← Skroluj vodorovně · Klik na oblak = detail události${EditMode.isActive() ? ' · Táhni oblak = přeskládat' : ''}</span>
          ${EditMode.isActive() ? `<button class="tl-add-btn" onclick="EditMode.startNewEvent()">＋ Nová událost</button>` : ''}
        </div>
        <div class="tl-viewport" id="tl-viewport">
          <div class="tl-canvas" id="tl-canvas" style="position:relative;height:${CANVAS_H}px">
            <div class="tl-axis-line" id="tl-axis-line" style="top:${AXIS_Y}px"></div>
          </div>
        </div>
      </div>
    `;

    const canvas = document.getElementById('tl-canvas');
    let x = PAD_LEFT;
    let globalIdx = 0;

    // ── Past events ─────────────────────────────────────────────
    if (pastEvents.length) {
      const startX = x;
      pastEvents.forEach(e => {
        _placeEvent(canvas, e, x, globalIdx);
        x += SLOT_W;
        globalIdx++;
      });
      _placeSectionBracket(canvas, startX, x, 'Dávná minulost', true);
      // Divider between past and sessions
      _placeDivider(canvas, x);
      x += DIV_W;
    }

    // ── Session events ───────────────────────────────────────────
    for (let s = 1; s <= maxSitting; s++) {
      const sEvents = allEvents.filter(e => e.sitting === s);
      if (!sEvents.length) continue;

      const startX = x;
      sEvents.forEach(e => {
        _placeEvent(canvas, e, x, globalIdx);
        x += SLOT_W;
        globalIdx++;
      });
      _placeSectionBracket(canvas, startX, x, `Sezení ${s}`, false);

      if (s < maxSitting) {
        _placeDivider(canvas, x);
        x += DIV_W;
      }
    }

    x += PAD_RIGHT;

    // Stretch canvas and axis
    canvas.style.width = x + 'px';
    const axisLine = document.getElementById('tl-axis-line');
    axisLine.style.width = x + 'px';
  }

  return { render };
})();

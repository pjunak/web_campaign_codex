import { Store } from './store.js';
import { Widgets } from './widgets/widgets.js';

export const WorldMap = (() => {

  const LS_IMG_KEY  = 'world_map_image_url';
  const DEFAULT_IMG = '/maps/swordcoast/sword_coast.jpg';

  function _getImgUrl() {
    return localStorage.getItem(LS_IMG_KEY) || DEFAULT_IMG;
  }

  const PIN_TYPES = {
    major_city: { icon: '🏙', label: 'Velké město',   color: '#D4A017' },
    city:       { icon: '🏛', label: 'Město',          color: '#C0A060' },
    town:       { icon: '🏘', label: 'Městečko',       color: '#A0B080' },
    village:    { icon: '🏠', label: 'Vesnice',        color: '#80A070' },
    fortress:   { icon: '🏰', label: 'Pevnost',        color: '#9090A0' },
    dungeon:    { icon: '⚠', label: 'Dungeon',         color: '#A06040' },
    landmark:   { icon: '⛩', label: 'Bod zájmu',      color: '#80A0B0' },
    region:     { icon: '🗺', label: 'Oblast',         color: '#708090' },
    enemy:      { icon: '💀', label: 'Nepřátelské',    color: '#B04040' },
    custom:     { icon: '📌', label: 'Vlastní',        color: '#8A5CC8' },
  };

  const PIN_STATUSES = {
    known:     { label: 'Známé',         ring: '#D4B87A' },
    visited:   { label: 'Navštívené',    ring: '#4CAF50' },
    enemy:     { label: 'Nepřátelské',   ring: '#E53935' },
    fog:       { label: 'Neprozkoumaný', ring: '#555'   },
  };

  let _map       = null;
  let _imgW      = 1;
  let _imgH      = 1;
  let _bounds    = null;
  let _markers   = {};
  let _addMode   = false;
  let _editPinId = null;
  let _modeObserver    = null;
  let _resizeObserver  = null;
  let _eventPathsVisible = false;
  let _eventMarkers    = [];
  let _eventPolylines  = [];

  function _toLL(fx, fy)  { return L.latLng(-fy * _imgH, fx * _imgW); }
  function _toFrac(ll)    { return { x: ll.lng / _imgW, y: -ll.lat / _imgH }; }

  function render() {
    document.getElementById('main-content').innerHTML = `
      <div class="sc-shell">
        <div class="sc-toolbar">
          <div class="sc-title">🗺 Mapa světa</div>
          <button class="sc-btn ${_addMode ? 'active' : ''}" id="sc-add-btn" onclick="WorldMap.toggleAddMode()">
            ${_addMode ? '✕ Zrušit' : '+ Přidat místo'}
          </button>
          <button class="sc-btn ${_eventPathsVisible ? 'active' : ''}" id="sc-event-btn" onclick="WorldMap.toggleEventPaths()" title="Zobraz polohy a trasy událostí z Časové Osy">
            📜 Trasy událostí
          </button>
          <button class="sc-btn" onclick="WorldMap.showSettings()">⚙ Mapa</button>
          <span class="sc-hint">${_addMode
            ? 'Klikni na mapu pro přidání nového místa'
            : 'Klik = detail místa · Kolečko = zoom · Táhni = pohyb'
          }</span>
        </div>
        <div id="sc-map-container"></div>
        <div class="sc-legend" id="sc-legend"></div>
      </div>

      <!-- Pin detail / edit panel -->
      <div class="sc-panel" id="sc-panel" hidden>
        <button class="sc-panel-close" onclick="WorldMap.closePanel()">✕</button>
        <div id="sc-panel-content"></div>
      </div>

      <!-- Settings dialog -->
      <div class="sc-overlay" id="sc-overlay" hidden>
        <div class="sc-dialog">
          <div class="sc-dialog-title">⚙ Nastavení mapy</div>
          <p class="sc-dialog-hint">
            <strong>Možnost 1 – nahrát obrázek:</strong> Vyber soubor ze svého počítače (doporučeno).<br>
            <strong>Možnost 2 – URL:</strong> Vlož přímý odkaz na obrázek mapy.<br>
            <strong>Možnost 3 – server:</strong> Ulož obrázek jako <code>data/maps/swordcoast/sword_coast.jpg</code> na serveru.
          </p>
          <label class="sc-label">Nahrát ze souboru</label>
          <label class="sc-btn" style="cursor:pointer;display:inline-block;margin-bottom:0.8rem">
            📂 Vybrat soubor…
            <input type="file" accept="image/*" style="display:none" onchange="WorldMap.handleMapFileUpload(this)">
          </label>
          <label class="sc-label">— nebo zadat URL obrázku —</label>
          <input class="sc-input" id="sc-img-url" type="text" value="${_esc(_getImgUrl().startsWith('data:') ? '' : _getImgUrl())}">
          <div class="sc-dialog-actions">
            <button class="sc-btn ok" onclick="WorldMap.applySettings()">✓ Použít URL</button>
            <button class="sc-btn" onclick="WorldMap.closeSettings()">Zrušit</button>
          </div>
        </div>
      </div>
    `;

    _initLeaflet();
    _renderLegend();
  }

  function _initLeaflet() {
    _clearEventPaths();
    if (_modeObserver)   { _modeObserver.disconnect();   _modeObserver   = null; }
    if (_resizeObserver) { _resizeObserver.disconnect(); _resizeObserver = null; }
    if (_map) { _map.remove(); _map = null; }

    const imgUrl    = _getImgUrl();
    const container = document.getElementById('sc-map-container');

    const img = new Image();
    img.onload  = () => _doInit(img, imgUrl, container);
    img.onerror = () => _showMapError(container);
    img.src = imgUrl;
  }

  function _fitZoom() {
    if (!_map || !_bounds) return -3;
    return _map.getBoundsZoom(_bounds, false);
  }

  function _enforceFitZoom() {
    if (!_map) return;
    const minZ = _fitZoom();
    _map.setMinZoom(minZ);
    if (_map.getZoom() < minZ) {
      _map.fitBounds(_bounds, { animate: true });
    }
  }

  function _doInit(img, imgUrl, container) {
    _imgW   = img.naturalWidth  || 2048;
    _imgH   = img.naturalHeight || 1340;
    _bounds = [[-_imgH, 0], [0, _imgW]];

    _map = L.map(container, {
      crs:                 L.CRS.Simple,
      minZoom:             -8,
      maxZoom:             2,
      zoomSnap:            0.25,
      zoomDelta:           0.5,
      wheelPxPerZoomLevel: 120,
      attributionControl:  false,
    });

    L.imageOverlay(imgUrl, _bounds).addTo(_map);
    _map.fitBounds(_bounds);

    requestAnimationFrame(() => _enforceFitZoom());

    _markers = {};
    Store.getMapPins().forEach(_placePin);

    _map.on('click', evt => {
      if (!_addMode) return;
      const frac = _toFrac(evt.latlng);
      _openNewPin(frac.x, frac.y);
      _setAddMode(false);
    });

    _modeObserver = new MutationObserver(() => {
      const editable = document.body.classList.contains('edit-mode');
      Object.values(_markers).forEach(m => {
        if (m.dragging) editable ? m.dragging.enable() : m.dragging.disable();
      });
    });
    _modeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });

    if (_resizeObserver) _resizeObserver.disconnect();
    _resizeObserver = new ResizeObserver(() => {
      if (!_map) return;
      _map.invalidateSize();
      _enforceFitZoom();
    });
    _resizeObserver.observe(container);
  }

  function _showMapError(container) {
    container.innerHTML = `
      <div class="sc-img-error">
        <div style="font-size:2rem;margin-bottom:1rem">🗺</div>
        <div style="font-size:1.1rem;margin-bottom:0.5rem"><strong>Mapa se nenačetla</strong></div>
        <div style="font-size:0.88rem;line-height:1.6;max-width:420px">
          Nahraj obrázek mapy přes <strong>⚙ Mapa → Vybrat soubor</strong>, nebo ho ulož na server jako
          <code>data/maps/swordcoast/sword_coast.jpg</code>.
        </div>
        <button class="sc-btn" style="margin-top:1.2rem" onclick="WorldMap.showSettings()">⚙ Otevřít nastavení</button>
      </div>`;
  }

  function _pinIcon(pin) {
    const pt   = PIN_TYPES[pin.type]  || PIN_TYPES.custom;
    const ps   = PIN_STATUSES[pin.status] || PIN_STATUSES.known;
    const size = pin.type === 'major_city' ? 28 : 22;
    return L.divIcon({
      className: '',
      iconSize:  [size, size],
      iconAnchor:[size/2, size/2],
      html: `<div class="sc-pin sc-pin-${pin.status}" style="
        width:${size}px;height:${size}px;
        background:${pt.color}22;
        border:2px solid ${ps.ring};
        font-size:${size*0.55}px;
      " title="${_esc(pin.name)}">${pt.icon}</div>`,
    });
  }

  function _placePin(pin) {
    if (!_map) return;
    const ll = _toLL(pin.x, pin.y);
    const m  = L.marker(ll, {
      icon:      _pinIcon(pin),
      draggable: true,
      title:     pin.name,
    }).addTo(_map);
    if (!document.body.classList.contains('edit-mode')) m.dragging.disable();

    m.on('click', () => _openPinPanel(pin.id));
    m.on('dragend', () => {
      const frac    = _toFrac(m.getLatLng());
      const current = Store.getMapPins().find(p => p.id === pin.id);
      if (!current) return;
      Store.saveMapPin({ ...current, x: frac.x, y: frac.y });
    });

    _markers[pin.id] = m;
  }

  function _refreshPin(pinId) {
    const pin = Store.getMapPins().find(p => p.id === pinId);
    if (!pin) return;
    if (_markers[pinId]) { _markers[pinId].remove(); delete _markers[pinId]; }
    _placePin(pin);
  }

  function _openPinPanel(pinId) {
    const pin = Store.getMapPins().find(p => p.id === pinId);
    if (!pin) return;
    _editPinId = pinId;
    const pt = PIN_TYPES[pin.type]  || PIN_TYPES.custom;
    const ps = PIN_STATUSES[pin.status] || PIN_STATUSES.known;
    const loc = pin.locationId ? Store.getLocation(pin.locationId) : null;

    document.getElementById('sc-panel-content').innerHTML = `
      <div class="sc-pin-view">
        <div class="sc-pin-header">
          <span class="sc-pin-icon">${pt.icon}</span>
          <div>
            <div class="sc-pin-name">${_esc(pin.name)}</div>
            <div class="sc-pin-meta">${pt.label} · <span style="color:${ps.ring}">${ps.label}</span></div>
          </div>
        </div>
        ${pin.notes ? `<div class="sc-pin-notes">${_esc(pin.notes)}</div>` : ''}
        ${loc ? `<div class="sc-pin-link">
          📍 <a href="#/misto/${loc.id}" onclick="WorldMap.closePanel()">Otevřít stránku místa</a>
        </div>` : ''}
        <div class="sc-pin-actions">
          <button class="sc-btn ok" onclick="WorldMap.openEditPin('${pinId}')">✏ Upravit</button>
          <button class="sc-btn err" onclick="WorldMap.deletePin('${pinId}')">🗑 Smazat</button>
        </div>
      </div>
    `;
    document.getElementById('sc-panel').removeAttribute('hidden');
  }

  function openEditPin(pinId) {
    const pin = Store.getMapPins().find(p => p.id === pinId) || {};
    _renderPinForm(pin, false);
  }

  function _openNewPin(x, y) {
    _renderPinForm({ x, y, status: 'known', type: 'custom' }, true);
    document.getElementById('sc-panel').removeAttribute('hidden');
  }

  function _renderPinForm(pin, isNew) {
    _editPinId = pin.id || null;
    const typeOpts = Object.entries(PIN_TYPES)
      .map(([k, v]) => `<option value="${k}" ${pin.type===k?'selected':''}>${v.icon} ${v.label}</option>`).join('');
    const statusOpts = Object.entries(PIN_STATUSES)
      .map(([k, v]) => `<option value="${k}" ${pin.status===k?'selected':''}>${v.label}</option>`).join('');

    document.getElementById('sc-panel-content').innerHTML = `
      <div class="sc-pin-form">
        <div class="sc-pin-form-title">${isNew ? 'Nové místo' : 'Upravit místo'}</div>
        <label class="sc-label">Název *</label>
        <input class="sc-input" id="spf-name" type="text" value="${_esc(pin.name||'')}" placeholder="Waterdeep...">
        <label class="sc-label">Typ</label>
        <select class="sc-input" id="spf-type">${typeOpts}</select>
        <label class="sc-label">Status</label>
        <select class="sc-input" id="spf-status">${statusOpts}</select>
        <label class="sc-label">Popis / Poznámky</label>
        <textarea class="sc-input" id="spf-notes" rows="3" placeholder="Krátký popis...">${_esc(pin.notes||'')}</textarea>
        <label class="sc-label">Propojit s kampaňovým místem</label>
        <div class="cb-mount"
          data-cb-id="spf-location"
          data-cb-source="location"
          data-cb-value="${_esc(pin.locationId || '')}"
          data-cb-allow-empty="1"
          data-cb-empty-label="— žádné —"
          data-cb-placeholder="Hledat místo…"></div>
        <div class="sc-pin-actions">
          <button class="sc-btn ok" onclick="WorldMap.savePin(${isNew}, ${pin.x||0}, ${pin.y||0})">💾 Uložit</button>
          ${!isNew ? `<button class="sc-btn" onclick="WorldMap.openPinPanel('${pin.id}')">Zpět</button>` : ''}
        </div>
      </div>
    `;
    document.getElementById('sc-panel').removeAttribute('hidden');
    Widgets.mountAll(document.getElementById('sc-panel-content'));
  }

  function savePin(isNew, x, y) {
    const name = document.getElementById('spf-name')?.value.trim();
    if (!name) { alert('Název je povinný.'); return; }
    const id = _editPinId || ('pin_' + Store.generateId(name) + '_' + Date.now());
    const existing = isNew ? null : Store.getMapPins().find(p => p.id === _editPinId);
    Store.saveMapPin({
      id,
      name,
      type:       document.getElementById('spf-type')?.value    || 'custom',
      status:     document.getElementById('spf-status')?.value  || 'known',
      notes:      document.getElementById('spf-notes')?.value   || '',
      locationId: document.getElementById('spf-location')?.value || null,
      x: existing ? existing.x : x,
      y: existing ? existing.y : y,
    });
    _refreshPin(id);
    _openPinPanel(id);
  }

  function openPinPanel(pinId) { _openPinPanel(pinId); }

  function deletePin(pinId) {
    const pin = Store.getMapPins().find(p => p.id === pinId);
    if (!pin) return;
    if (!confirm(`Smazat místo „${pin.name}"?`)) return;
    Store.deleteMapPin(pinId);
    if (_markers[pinId]) { _markers[pinId].remove(); delete _markers[pinId]; }
    closePanel();
  }

  function _drawEventPaths() {
    _clearEventPaths();
    if (!_map) return;

    const events = [...Store.getEvents()].sort((a, b) => {
      const sA = a.sitting ?? 0;
      const sB = b.sitting ?? 0;
      if (sA !== sB) return sA - sB;
      return (a.order ?? 0) - (b.order ?? 0);
    });

    const pins = Store.getMapPins();

    const eventPoints = events.map(e => {
      const primaryLocId = (e.locations || [])[0];
      if (!primaryLocId) return null;
      const pin = pins.find(p => p.locationId === primaryLocId);
      if (!pin) return null;
      return { event: e, pin, ll: _toLL(pin.x, pin.y) };
    }).filter(Boolean);

    if (!eventPoints.length) return;

    for (let i = 1; i < eventPoints.length; i++) {
      const prev = eventPoints[i - 1];
      const curr = eventPoints[i];
      if (prev.pin.id === curr.pin.id) continue;
      const line = L.polyline([prev.ll, curr.ll], {
        color:      '#C8A040',
        weight:     2.5,
        opacity:    0.75,
        dashArray:  '7, 5',
      }).addTo(_map);
      _eventPolylines.push(line);
    }

    eventPoints.forEach(({ event: e, ll }) => {
      const sittingLabel = e.sitting ? `S${e.sitting}` : '✦';
      const bgColor      = e.sitting ? '#8B6914' : '#5A3A5A';
      const icon = L.divIcon({
        className: '',
        iconSize:  [28, 28],
        iconAnchor:[14, 14],
        html: `<div class="sc-event-marker" title="${_esc(e.name)}"
                    style="background:${bgColor}">
                 <span class="sc-event-marker-label">${_esc(sittingLabel)}</span>
                 <span class="sc-event-marker-num">#${e.order}</span>
               </div>`,
      });
      const m = L.marker(ll, { icon, interactive: true }).addTo(_map);
      m.on('click', () => { window.location.hash = `#/udalost/${e.id}`; });
      _eventMarkers.push(m);
    });
  }

  function _clearEventPaths() {
    _eventMarkers.forEach(m => m.remove());
    _eventPolylines.forEach(l => l.remove());
    _eventMarkers   = [];
    _eventPolylines = [];
  }

  function toggleEventPaths() {
    _eventPathsVisible = !_eventPathsVisible;
    const btn = document.getElementById('sc-event-btn');
    if (btn) btn.classList.toggle('active', _eventPathsVisible);
    if (_eventPathsVisible) _drawEventPaths();
    else                    _clearEventPaths();
    _renderLegend();
  }

  function _setAddMode(on) {
    _addMode = on;
    const btn = document.getElementById('sc-add-btn');
    const hint = document.querySelector('.sc-hint');
    if (btn)  btn.textContent = on ? '✕ Zrušit' : '+ Přidat místo';
    if (btn)  btn.classList.toggle('active', on);
    if (hint) hint.textContent = on
      ? 'Klikni na mapu pro přidání nového místa'
      : 'Klik = detail místa · Kolečko = zoom · Táhni = pohyb';
    if (_map) _map.getContainer().style.cursor = on ? 'crosshair' : '';
  }

  function toggleAddMode() { _setAddMode(!_addMode); }

  function closePanel() {
    document.getElementById('sc-panel')?.setAttribute('hidden', '');
    _editPinId = null;
  }

  function showSettings() {
    document.getElementById('sc-overlay')?.removeAttribute('hidden');
  }

  function closeSettings() {
    document.getElementById('sc-overlay')?.setAttribute('hidden', '');
  }

  function handleMapFileUpload(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      try { localStorage.setItem(LS_IMG_KEY, e.target.result); } catch (err) {
        alert('Soubor je příliš velký pro uložení v prohlížeči. Zkus menší obrázek nebo ho ulož na server jako data/maps/swordcoast/sword_coast.jpg.');
        return;
      }
      closeSettings();
      _initLeaflet();
    };
    reader.readAsDataURL(file);
  }

  function applySettings() {
    const url = document.getElementById('sc-img-url')?.value.trim();
    if (url) {
      try { localStorage.setItem(LS_IMG_KEY, url); } catch (e) { /* private browsing / quota */ }
      closeSettings();
      _initLeaflet();
    }
  }

  function _renderLegend() {
    const leg = document.getElementById('sc-legend');
    if (!leg) return;
    leg.innerHTML = `
      <div class="legend-title">Status</div>
      ${Object.entries(PIN_STATUSES).map(([, v]) =>
        `<div class="legend-item">
          <div class="legend-dot" style="background:${v.ring}"></div>
          ${v.label}
        </div>`
      ).join('')}
      ${_eventPathsVisible ? `
        <div class="legend-title" style="margin-top:0.8rem">Trasy událostí</div>
        <div class="legend-item">
          <div class="legend-line" style="border-top:2px dashed #C8A040"></div> Cesta příběhu
        </div>
        <div class="legend-item">
          <div class="sc-event-marker-tiny" style="background:#8B6914">S#</div> V sezení
        </div>
        <div class="legend-item">
          <div class="sc-event-marker-tiny" style="background:#5A3A5A">✦</div> Minulost
        </div>` : ''}
    `;
  }

  function _esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  return {
    render,
    toggleAddMode, closePanel,
    toggleEventPaths,
    openEditPin, openPinPanel, savePin, deletePin,
    showSettings, closeSettings, applySettings, handleMapFileUpload,
  };
})();

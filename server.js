const express      = require('express');
const multer       = require('multer');
const archiver     = require('archiver');
const fs           = require('fs');
const path         = require('path');
const crypto       = require('crypto');
const cookieParser = require('cookie-parser');

const app  = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR       = path.join(__dirname, 'data');
const PORTRAITS_DIR  = path.join(__dirname, 'data', 'portraits');
const MAPS_DIR       = path.join(__dirname, 'data', 'maps');
const LOCAL_MAPS_DIR = path.join(MAPS_DIR, 'local');
const TILES_DIR      = path.join(MAPS_DIR, 'tiles');
const SWORDCOAST_DIR = path.join(MAPS_DIR, 'swordcoast');
const SNAPSHOTS_DIR  = path.join(DATA_DIR, 'snapshots');
const WEB_DIR        = path.join(__dirname, 'web');

fs.mkdirSync(DATA_DIR,       { recursive: true });
fs.mkdirSync(PORTRAITS_DIR,  { recursive: true });
fs.mkdirSync(LOCAL_MAPS_DIR, { recursive: true });
fs.mkdirSync(TILES_DIR,      { recursive: true });
fs.mkdirSync(SWORDCOAST_DIR, { recursive: true });
fs.mkdirSync(SNAPSHOTS_DIR,  { recursive: true });

app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));

// ── Auth ──────────────────────────────────────────────────────────
// Cookie value is SHA256(password); compared with timingSafeEqual to
// avoid leaking length/prefix info via timing side channel.
function _expectedToken() {
  const pwd = process.env.EDIT_PASSWORD || '123';
  return crypto.createHash('sha256').update(pwd).digest('hex');
}
function _safeEq(a, b) {
  const ba = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}
const requireAuth = (req, res, next) => {
  if (_safeEq(req.cookies.edit_session, _expectedToken())) return next();
  res.status(401).json({ error: 'Neznámé nebo chybějící heslo.' });
};

app.use('/portraits', express.static(PORTRAITS_DIR));
app.use('/maps',      express.static(MAPS_DIR));
app.use(express.static(WEB_DIR));

function _imageFilter(_req, file, cb) {
  cb(null, file.mimetype.startsWith('image/'));
}

const charStorage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const charId = (req.params.charId || '').replace(/[^a-z0-9_\-]/gi, '_').substring(0, 60);
    const dir    = path.join(PORTRAITS_DIR, charId);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, 'portrait' + ext);
  },
});

const uploadChar = multer({ storage: charStorage, limits: { fileSize: 20 * 1024 * 1024 }, fileFilter: _imageFilter });

const localMapStorage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const locId = (req.params.locId || '').replace(/[^a-z0-9_\-]/gi, '_').substring(0, 60);
    const dir   = path.join(LOCAL_MAPS_DIR, locId);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, 'map' + ext);
  },
});
const uploadLocalMap = multer({ storage: localMapStorage, limits: { fileSize: 20 * 1024 * 1024 }, fileFilter: _imageFilter });

// ── Atomic write helper ──────────────────────────────────────────
// Writing JSON directly can corrupt the file if the server is killed
// mid-write. We write to a sibling `.tmp` and `rename()` into place —
// POSIX rename is atomic on the same filesystem.
function _atomicWrite(filePath, content) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, filePath);
}

// ── Snapshot system ──────────────────────────────────────────────
// Every PATCH / POST that writes data creates a point-in-time
// snapshot of the entire JSON dataset under `data/snapshots/`.
// One file per snapshot, shape:
//   { id, createdAt, dataHash, reason, files: { "<name>.json": <parsed> } }
// Writes coalesce within a 60 s window so burst-edits (e.g.
// saveLocation's peer cascade) produce one snapshot per logical
// action. Retention: keep the most recent 50 snapshots, plus one
// per UTC-day for the last 14 days — whichever is more.
const SNAPSHOT_COALESCE_MS = 60 * 1000;
const SNAPSHOT_RECENT_KEEP = 50;
const SNAPSHOT_DAILY_DAYS  = 14;

function _snapshotFiles() {
  try {
    return fs.readdirSync(SNAPSHOTS_DIR)
      .filter(f => /^snapshot-.*\.json$/.test(f))
      .sort();
  } catch { return []; }
}

function _readSnapshot(id) {
  const safe = String(id || '').replace(/[^a-zA-Z0-9_\-\.]/g, '');
  const file = path.join(SNAPSHOTS_DIR, safe);
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return null; }
}

function _snapshotMeta(filename) {
  const file = path.join(SNAPSHOTS_DIR, filename);
  try {
    const stat = fs.statSync(file);
    const snap = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      id:        filename,
      createdAt: snap.createdAt,
      dataHash:  snap.dataHash,
      reason:    snap.reason || 'save',
      size:      stat.size,
    };
  } catch { return null; }
}

function _lastSnapshotTime() {
  const files = _snapshotFiles();
  if (!files.length) return 0;
  const meta = _snapshotMeta(files[files.length - 1]);
  return meta && meta.createdAt ? Date.parse(meta.createdAt) : 0;
}

function _createSnapshot(reason = 'save') {
  const now       = Date.now();
  const createdAt = new Date(now).toISOString();
  const files     = {};
  try {
    for (const f of fs.readdirSync(DATA_DIR)) {
      if (!f.endsWith('.json')) continue;
      try {
        files[f] = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8'));
      } catch (_) { /* skip corrupt file */ }
    }
  } catch (_) { /* data dir missing is OK */ }
  const snap = {
    id:        `snapshot-${createdAt.replace(/[:.]/g, '-')}.json`,
    createdAt,
    dataHash:  _dataHash(),
    reason,
    files,
  };
  const target = path.join(SNAPSHOTS_DIR, snap.id);
  _atomicWrite(target, JSON.stringify(snap));
  _pruneSnapshots();
  return snap.id;
}

// Keep last N plus one per UTC-day for D days. Anything outside
// both windows is deleted.
function _pruneSnapshots() {
  const files = _snapshotFiles();
  if (files.length <= SNAPSHOT_RECENT_KEEP) return;

  const metas = files.map(_snapshotMeta).filter(Boolean);
  metas.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

  const keep = new Set();
  // Recent window: last N regardless of date.
  metas.slice(-SNAPSHOT_RECENT_KEEP).forEach(m => keep.add(m.id));

  // Daily window: one snapshot per UTC-day for the last D days.
  const byDay = new Map();
  const oldestDayMs = Date.now() - SNAPSHOT_DAILY_DAYS * 86_400_000;
  for (const m of metas) {
    const t = Date.parse(m.createdAt);
    if (t < oldestDayMs) continue;
    const day = m.createdAt.slice(0, 10);
    // Keep the last snapshot of each day (not first, since that
    // captures the most work done that day).
    byDay.set(day, m.id);
  }
  for (const id of byDay.values()) keep.add(id);

  for (const m of metas) {
    if (keep.has(m.id)) continue;
    try { fs.unlinkSync(path.join(SNAPSHOTS_DIR, m.id)); } catch (_) {}
  }
}

// Take a snapshot unless the last one is within the coalesce window.
// Called AFTER a successful write — snapshot N represents the data
// state after change N, so restoring N puts you back to that moment.
function _maybeSnapshot(reason = 'save') {
  const last = _lastSnapshotTime();
  if (last && Date.now() - last < SNAPSHOT_COALESCE_MS) return null;
  try { return _createSnapshot(reason); }
  catch (e) { console.warn('[snapshot] create failed:', e.message); return null; }
}

// Restore a snapshot: overwrite every JSON file in data/ with the
// snapshot's contents, and delete any JSON file present today that
// the snapshot didn't have. Before restoring, take a "pre-restore"
// snapshot so the operation itself is undoable.
function _restoreSnapshot(id) {
  const snap = _readSnapshot(id);
  if (!snap || !snap.files) return { ok: false, error: 'Snapshot nenalezen' };
  _createSnapshot('pre-restore');
  // Write every file in the snapshot.
  for (const [name, content] of Object.entries(snap.files)) {
    if (!/^[a-z0-9_]+\.json$/i.test(name)) continue;
    _atomicWrite(path.join(DATA_DIR, name), JSON.stringify(content, null, 2));
  }
  // Remove any JSON file not in the snapshot (e.g. a collection
  // added after the snapshot that didn't exist then).
  try {
    for (const f of fs.readdirSync(DATA_DIR)) {
      if (!f.endsWith('.json')) continue;
      if (!Object.prototype.hasOwnProperty.call(snap.files, f)) {
        try { fs.unlinkSync(path.join(DATA_DIR, f)); } catch (_) {}
      }
    }
  } catch (_) {}
  return { ok: true };
}

// ── Data hash ────────────────────────────────────────────────────
// Content-hashed — previous mtime+size version gave false positives
// on filesystems with low-res mtime (e.g. Docker on Windows) and false
// negatives on touch(1). We hash the concatenated JSON file contents,
// which is cheap enough for our ~100 KB dataset.
function _dataHash() {
  try {
    const h = crypto.createHash('sha1');
    fs.readdirSync(DATA_DIR)
      .filter(f => f.endsWith('.json'))
      .sort()
      .forEach(f => {
        h.update(f);
        h.update('\0');
        h.update(fs.readFileSync(path.join(DATA_DIR, f)));
        h.update('\0');
      });
    return h.digest('hex').slice(0, 16);
  } catch {
    return 'none';
  }
}

function getFile(type) {
  const safeType = (type || '').replace(/[^a-z0-9_]/gi, '');
  return path.join(DATA_DIR, safeType + '.json');
}

// ── SSE broadcast (Phase 5.1) ────────────────────────────────────
const _sseClients = new Set();
function _broadcast(eventName, payload) {
  const data = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of _sseClients) {
    try { res.write(data); } catch (_) { /* client gone — cleanup on close */ }
  }
}
function _broadcastDataChanged() {
  _broadcast('data-changed', { hash: _dataHash(), at: Date.now() });
}

// ── Allowed collections ──────────────────────────────────────────
// Defense in depth: reject unknown collection names at the API
// boundary. Clients should never produce these, but a buggy build or
// a hand-crafted PATCH could. Enum validation (relationship type,
// character status, artifact state, pin type, etc.) lives in the
// client-side `settings` collection — the server trusts sent ids.
const ALLOWED_TYPES = new Set([
  'characters', 'relationships', 'locations', 'events',
  'mysteries', 'factions', 'deletedDefaults',
  'species', 'pantheon', 'artifacts', 'settings',
  'historicalEvents', 'campaign',
]);
const ALL_TYPES = [
  'characters', 'relationships', 'locations', 'events',
  'mysteries', 'factions', 'deletedDefaults',
  'species', 'pantheon', 'artifacts', 'settings',
  'historicalEvents', 'campaign',
];

app.get('/api/data', (_req, res) => {
  try {
    const campaign = {};
    let foundAny   = false;
    for (const t of ALL_TYPES) {
      const p = getFile(t);
      if (fs.existsSync(p)) {
        campaign[t] = JSON.parse(fs.readFileSync(p, 'utf8'));
        foundAny    = true;
      }
    }
    if (!foundAny) return res.json(null);
    res.type('application/json').send(JSON.stringify(campaign));
  } catch (e) {
    console.error('GET /api/data:', e);
    res.status(500).json({ error: 'Read error' });
  }
});

// ── Login rate limit ─────────────────────────────────────────────
// In-memory sliding window. Blocks an IP after 10 failed attempts in
// 15 minutes. Resets on successful login. Good enough for a small
// campaign wiki; a proper reverse proxy would do this upstream.
const _loginAttempts = new Map();   // ip → { count, firstMs }
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX       = 10;
function _loginKey(req) {
  return (req.ip || req.connection?.remoteAddress || 'unknown').toString();
}
function _isBlocked(ip) {
  const rec = _loginAttempts.get(ip);
  if (!rec) return false;
  if (Date.now() - rec.firstMs > LOGIN_WINDOW_MS) { _loginAttempts.delete(ip); return false; }
  return rec.count >= LOGIN_MAX;
}
function _noteFailure(ip) {
  const now = Date.now();
  const rec = _loginAttempts.get(ip);
  if (!rec || now - rec.firstMs > LOGIN_WINDOW_MS) {
    _loginAttempts.set(ip, { count: 1, firstMs: now });
  } else {
    rec.count++;
  }
}

app.post('/api/login', (req, res) => {
  const ip = _loginKey(req);
  if (_isBlocked(ip)) {
    return res.status(429).json({ error: 'Příliš mnoho neúspěšných pokusů. Zkus to za 15 minut.' });
  }
  const { password } = req.body || {};
  const expected     = process.env.EDIT_PASSWORD || '123';
  if (typeof password !== 'string' || !_safeEq(password, expected)) {
    _noteFailure(ip);
    return res.status(401).json({ error: 'Špatné heslo' });
  }
  _loginAttempts.delete(ip);
  res.cookie('edit_session', _expectedToken(), {
    httpOnly: true,
    sameSite: 'lax',
    path:     '/',
    maxAge:   30 * 24 * 60 * 60 * 1000,   // 30 days
  });
  res.json({ ok: true });
});

app.get('/api/auth', requireAuth, (_req, res) => {
  res.json({ ok: true });
});

app.post('/api/data', requireAuth, (req, res) => {
  try {
    const body = req.body;
    if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Invalid data' });
    for (const key of Object.keys(body)) {
      if (!ALLOWED_TYPES.has(key)) return res.status(400).json({ error: `Unknown collection: ${key}` });
    }
    for (const [key, value] of Object.entries(body)) {
      if (typeof value === 'object') _atomicWrite(getFile(key), JSON.stringify(value, null, 2));
    }
    _maybeSnapshot('save');
    _broadcastDataChanged();
    res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/data:', e);
    res.status(500).json({ error: 'Write error' });
  }
});

app.patch('/api/data', requireAuth, (req, res) => {
  try {
    const { type, action, payload } = req.body || {};

    if (!ALLOWED_TYPES.has(type)) {
      return res.status(400).json({ error: `Unknown collection: ${type}` });
    }
    if (action !== 'save' && action !== 'delete') {
      return res.status(400).json({ error: `Unknown action: ${action}` });
    }
    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({ error: 'Missing payload' });
    }

    const p = getFile(type);
    // Keyed-object collections: factions (id → record), settings
    // (category → array), and campaign (single 'main' record).
    // Everything else is an entity list.
    let container = (type === 'factions' || type === 'settings' || type === 'campaign') ? {} : [];
    if (fs.existsSync(p)) container = JSON.parse(fs.readFileSync(p, 'utf8'));

    // Auto-migrate portrait to canonical subfolder on character save
    if (type === 'characters' && action === 'save' && payload?.id && payload?.portrait) {
      const charId         = payload.id;
      const cleanUrl       = payload.portrait.split('?')[0];
      const expectedPrefix = `/portraits/${charId}/portrait.`;
      if (!cleanUrl.startsWith(expectedPrefix)) {
        const relPath = cleanUrl.replace(/^\/portraits\//, '');
        const srcFile = path.join(PORTRAITS_DIR, ...relPath.split('/').filter(Boolean));
        if (fs.existsSync(srcFile) && fs.statSync(srcFile).isFile()) {
          const ext      = path.extname(srcFile).toLowerCase() || '.jpg';
          const destDir  = path.join(PORTRAITS_DIR, charId);
          const destFile = path.join(destDir, `portrait${ext}`);
          try {
            fs.mkdirSync(destDir, { recursive: true });
            try { fs.readdirSync(destDir).filter(f => /^portrait\./i.test(f)).forEach(f => fs.unlinkSync(path.join(destDir, f))); } catch (_) {}
            fs.renameSync(srcFile, destFile);
            const srcDir = path.dirname(srcFile);
            if (srcDir !== PORTRAITS_DIR) {
              try { if (fs.readdirSync(srcDir).length === 0) fs.rmdirSync(srcDir); } catch (_) {}
            }
            payload.portrait = `/portraits/${charId}/portrait${ext}`;
          } catch (e) {
            console.warn(`[portrait] Migration failed for ${charId}:`, e.message);
            payload.portrait = cleanUrl;
          }
        } else {
          payload.portrait = cleanUrl;
        }
      } else {
        payload.portrait = cleanUrl;
      }
    }

    if (action === 'save') {
      if (Array.isArray(container)) {
        if (type === 'relationships') {
          const k   = r => `${r.source}||${r.target}||${r.type}`;
          const idx = container.findIndex(r => k(r) === k(payload));
          if (idx >= 0) container[idx] = payload; else container.push(payload);
        } else {
          const idx = container.findIndex(x => x.id === payload.id);
          if (idx >= 0) container[idx] = payload; else container.push(payload);
        }
      } else {
        container[payload.id] = payload.data;
      }
    } else if (action === 'delete') {
      if (Array.isArray(container)) {
        if (type === 'relationships') {
          container = container.filter(r => !(r.source === payload.source && r.target === payload.target && r.type === payload.type));
        } else {
          container = container.filter(x => x.id !== payload.id);
          if (type === 'characters') {
            const relP = getFile('relationships');
            if (fs.existsSync(relP)) {
              let rels = JSON.parse(fs.readFileSync(relP, 'utf8'));
              rels = rels.filter(r => r.source !== payload.id && r.target !== payload.id);
              _atomicWrite(relP, JSON.stringify(rels, null, 2));
            }
            const evtP = getFile('events');
            if (fs.existsSync(evtP)) {
              let evts = JSON.parse(fs.readFileSync(evtP, 'utf8'));
              if (evts.some(e => (e.characters || []).includes(payload.id))) {
                evts = evts.map(e => ({ ...e, characters: (e.characters || []).filter(cid => cid !== payload.id) }));
                _atomicWrite(evtP, JSON.stringify(evts, null, 2));
              }
            }
            const mysP = getFile('mysteries');
            if (fs.existsSync(mysP)) {
              let mys = JSON.parse(fs.readFileSync(mysP, 'utf8'));
              if (mys.some(m => (m.characters || []).includes(payload.id))) {
                mys = mys.map(m => ({ ...m, characters: (m.characters || []).filter(cid => cid !== payload.id) }));
                _atomicWrite(mysP, JSON.stringify(mys, null, 2));
              }
            }
          }
        }
      } else {
        delete container[payload.id];
      }
    }

    _atomicWrite(p, JSON.stringify(container, null, 2));
    _maybeSnapshot('save');
    _broadcastDataChanged();
    res.json({ ok: true });
  } catch (e) {
    console.error('PATCH /api/data:', e);
    res.status(500).json({ error: 'Patch error' });
  }
});

app.get('/api/version', (_req, res) => {
  res.json({ hash: _dataHash() });
});

// ── SSE event stream (Phase 5.1) ──────────────────────────────────
app.get('/api/events', (req, res) => {
  res.set({
    'Content-Type':      'text/event-stream',
    'Cache-Control':     'no-cache, no-transform',
    'Connection':        'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  res.write(`event: hello\ndata: ${JSON.stringify({ hash: _dataHash(), at: Date.now() })}\n\n`);
  _sseClients.add(res);

  const ping = setInterval(() => {
    try { res.write(`: ping ${Date.now()}\n\n`); } catch (_) {}
  }, 25_000);

  req.on('close', () => {
    clearInterval(ping);
    _sseClients.delete(res);
  });
});

app.post('/api/portrait/:charId', requireAuth, uploadChar.single('portrait'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image received' });
  const charId  = (req.params.charId || '').replace(/[^a-z0-9_\-]/gi, '_').substring(0, 60);
  const charDir = path.join(PORTRAITS_DIR, charId);
  const newFile = req.file.filename;
  try {
    fs.readdirSync(charDir)
      .filter(f => f !== newFile && /^portrait\./i.test(f))
      .forEach(f => fs.unlinkSync(path.join(charDir, f)));
  } catch (_) {}
  res.json({ url: `/portraits/${charId}/${req.file.filename}` });
});

// ── Tile pyramid ──────────────────────────────────────────────────
// Maps are rendered in Leaflet via an on-disk pyramid of 256px tiles
// (zoom level z, column x, row y). `tiler.js` owns the actual pyramid
// build; we only wire the upload hook and the static route here.
let _tiler = null;
try { _tiler = require('./tiler'); }
catch (e) { console.warn('[tiles] sharp not installed — tile generation disabled:', e.message); }

app.post('/api/localmap/:locId', requireAuth, uploadLocalMap.single('localmap'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image received' });
  const locId  = (req.params.locId || '').replace(/[^a-z0-9_\-]/gi, '_').substring(0, 60);
  const locDir = path.join(LOCAL_MAPS_DIR, locId);
  const newFile = req.file.filename;
  try {
    fs.readdirSync(locDir)
      .filter(f => f !== newFile && /^map\./i.test(f))
      .forEach(f => fs.unlinkSync(path.join(locDir, f)));
  } catch (_) {}
  const url = `/maps/local/${locId}/${req.file.filename}`;
  // Kick off tile generation in the background; the URL above is
  // always usable (fallback), tiles just accelerate subsequent loads.
  if (_tiler) _tiler.buildFor(`local/${locId}`, path.join(locDir, newFile)).catch(e => {
    console.warn(`[tiles] build failed for local/${locId}:`, e.message);
  });
  res.json({ url });
});

// Serve tiles as static files. The tiler writes to
// data/maps/tiles/<mapId>/<z>/<x>/<y>.jpg; we expose them at the same
// path under /maps/tiles. Includes a tiles.json manifest per mapId.
app.use('/maps/tiles', express.static(TILES_DIR, { fallthrough: true, maxAge: '7d' }));

app.delete('/api/portrait/:identifier', requireAuth, (req, res) => {
  const identifier = (req.params.identifier || '').replace(/[^a-z0-9_\-\.]/gi, '_');
  const target     = path.join(PORTRAITS_DIR, identifier);
  try {
    if (!fs.existsSync(target)) return res.json({ ok: true });
    const stat = fs.statSync(target);
    if (stat.isDirectory()) fs.rmSync(target, { recursive: true, force: true });
    else fs.unlinkSync(target);
    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /api/portrait:', e);
    res.status(500).json({ error: 'Delete error' });
  }
});

// ── Snapshot API ─────────────────────────────────────────────
// The snapshot system lives in the helpers at the top of this file.
// Endpoints here expose list / create / restore / delete to the
// client so the /nastaveni Záloha tab can manage them.
app.get('/api/snapshots', requireAuth, (_req, res) => {
  const files = _snapshotFiles();
  const metas = files.map(_snapshotMeta).filter(Boolean);
  // Newest first for UI convenience.
  metas.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  res.json({ snapshots: metas });
});

app.post('/api/snapshots', requireAuth, (_req, res) => {
  try {
    const id = _createSnapshot('manual');
    res.json({ ok: true, id });
  } catch (e) {
    console.error('POST /api/snapshots:', e);
    res.status(500).json({ error: 'Snapshot failed' });
  }
});

app.post('/api/snapshots/:id/restore', requireAuth, (req, res) => {
  try {
    const r = _restoreSnapshot(req.params.id);
    if (!r.ok) return res.status(404).json(r);
    _broadcastDataChanged();
    res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/snapshots/:id/restore:', e);
    res.status(500).json({ error: 'Restore failed' });
  }
});

// Revert the last N changes by restoring the snapshot N-1 positions
// back in the newest-first list (so n=1 = second-newest snapshot,
// which represents state before the most recent change).
app.post('/api/snapshots/revert-last/:n', requireAuth, (req, res) => {
  const n = Math.max(1, Math.min(50, Number(req.params.n) || 1));
  const files = _snapshotFiles();
  if (files.length <= n) return res.status(400).json({ error: 'Nedostatek bodů zálohy pro zpětný krok' });
  // files is ascending by timestamp; the last entry is the newest.
  // To undo the last N changes, restore the snapshot N+1 from the end.
  const id = files[files.length - 1 - n];
  try {
    const r = _restoreSnapshot(id);
    if (!r.ok) return res.status(404).json(r);
    _broadcastDataChanged();
    res.json({ ok: true, id });
  } catch (e) {
    console.error('POST /api/snapshots/revert-last:', e);
    res.status(500).json({ error: 'Revert failed' });
  }
});

app.delete('/api/snapshots/:id', requireAuth, (req, res) => {
  const safe = String(req.params.id || '').replace(/[^a-zA-Z0-9_\-\.]/g, '');
  const file = path.join(SNAPSHOTS_DIR, safe);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Snapshot nenalezen' });
  try { fs.unlinkSync(file); res.json({ ok: true }); }
  catch (e) {
    console.error('DELETE /api/snapshots:', e);
    res.status(500).json({ error: 'Delete failed' });
  }
});

// ── World-map upload ─────────────────────────────────────────
// Writes the image to `data/maps/swordcoast/sword_coast.<ext>`
// (the canonical default path the client reads). Removes any
// existing world-map file with a different extension so the
// newest upload always wins. Triggers async tile-pyramid build.
const worldMapStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    fs.mkdirSync(SWORDCOAST_DIR, { recursive: true });
    cb(null, SWORDCOAST_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, 'sword_coast' + ext);
  },
});
const uploadWorldMap = multer({
  storage:    worldMapStorage,
  limits:     { fileSize: 40 * 1024 * 1024 },
  fileFilter: _imageFilter,
});

app.post('/api/worldmap', requireAuth, uploadWorldMap.single('worldmap'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image received' });
  const newFile = req.file.filename;
  try {
    fs.readdirSync(SWORDCOAST_DIR)
      .filter(f => f !== newFile && /^sword_coast\./i.test(f))
      .forEach(f => fs.unlinkSync(path.join(SWORDCOAST_DIR, f)));
  } catch (_) {}
  const url = `/maps/swordcoast/${newFile}`;
  // Schedule tile rebuild so the Leaflet path picks up the new image.
  if (_tiler) {
    const base = path.basename(newFile, path.extname(newFile));
    _tiler.buildFor(`swordcoast/${base}`, path.join(SWORDCOAST_DIR, newFile)).catch(e => {
      console.warn(`[tiles] build failed for swordcoast/${base}:`, e.message);
    });
  }
  res.json({ url });
});

// ── Full data/ backup as zip ──────────────────────────────────
app.get('/api/backup', requireAuth, (_req, res) => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename  = `backup-${timestamp}.zip`;

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', err => {
    console.error('Backup archive error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Backup failed' });
  });
  archive.pipe(res);
  archive.directory(DATA_DIR, 'data');
  archive.finalize();
});

// ── Full data/ restore from upload ────────────────────────────
// Accepts either:
//   - a .zip produced by /api/backup (entries under `data/...`)
//   - a single .json document in the shape Store.exportJSON() emits
// Always takes a `pre-restore` snapshot first so the operation is
// undoable from the Záloha tab. Path-traversal-safe: every entry
// is resolved against DATA_DIR and rejected if it would escape.
const AdmZip = require('adm-zip');
const restoreUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 200 * 1024 * 1024 },  // 200 MB hard cap
});

function _safeJoinDataDir(rel) {
  // Refuse traversal/absolute paths.
  if (!rel || rel.startsWith('/') || rel.startsWith('\\') || /(^|[\\/])\.\.([\\/]|$)/.test(rel)) {
    return null;
  }
  const target = path.join(DATA_DIR, rel);
  // path.resolve normalizes; verify the result is still inside DATA_DIR.
  const resolved = path.resolve(target);
  const root     = path.resolve(DATA_DIR);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  return resolved;
}

app.post('/api/restore', requireAuth, restoreUpload.single('backup'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Žádný soubor nepřijat' });

  const filename = String(req.file.originalname || '');
  const buffer   = req.file.buffer;

  // Detect format: ZIP starts with magic `PK\x03\x04`, JSON typically
  // with `{` (after optional whitespace).
  const isZipMagic  = buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4B
                                         && buffer[2] === 0x03 && buffer[3] === 0x04;
  const isZip       = /\.zip$/i.test(filename) || isZipMagic;
  const looksJson   = !isZip && (/\.json$/i.test(filename)
                       || /^\s*[\{\[]/.test(buffer.toString('utf8', 0, Math.min(64, buffer.length))));

  // Pre-restore snapshot — bypass the coalesce window so we always
  // capture the current state regardless of recent activity.
  try { _createSnapshot('pre-restore'); }
  catch (e) { console.warn('[restore] pre-restore snapshot failed:', e.message); }

  if (isZip) {
    let zip;
    try { zip = new AdmZip(buffer); }
    catch (e) { return res.status(400).json({ error: 'Neplatný ZIP soubor' }); }

    const entries  = zip.getEntries();
    const restored = [];
    const skipped  = [];
    for (const entry of entries) {
      if (entry.isDirectory) continue;
      // Normalize separators and strip the leading `data/` wrapper that
      // /api/backup adds. Other zip producers may put files at the root.
      let name = entry.entryName.replace(/\\/g, '/');
      if (name.startsWith('data/')) name = name.slice(5);
      if (!name) continue;

      const target = _safeJoinDataDir(name);
      if (!target) { skipped.push(name); continue; }
      try {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, entry.getData());
        restored.push(name);
      } catch (e) {
        console.warn('[restore] failed entry', name, e.message);
        skipped.push(name);
      }
    }

    // Rebuild tile pyramids in the background so map images uploaded
    // along with the backup get fresh tiles.
    try { _backgroundTileSweep(); } catch (_) {}

    _broadcastDataChanged();
    return res.json({ ok: true, format: 'zip', restored: restored.length, skipped: skipped.length });
  }

  if (looksJson) {
    let parsed;
    try { parsed = JSON.parse(buffer.toString('utf8')); }
    catch (e) { return res.status(400).json({ error: 'Neplatný JSON soubor' }); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return res.status(400).json({ error: 'Neplatný formát zálohy (očekávám objekt)' });
    }
    const restored = [];
    for (const t of ALL_TYPES) {
      if (parsed[t] === undefined) continue;
      _atomicWrite(getFile(t), JSON.stringify(parsed[t], null, 2));
      restored.push(`${t}.json`);
    }
    if (!restored.length) {
      return res.status(400).json({ error: 'JSON neobsahuje žádnou známou kolekci' });
    }
    _broadcastDataChanged();
    return res.json({ ok: true, format: 'json', restored: restored.length });
  }

  return res.status(400).json({ error: 'Nepodporovaný formát — očekávám .zip nebo .json' });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(WEB_DIR, 'index.html'));
});

// ── Bootstrap: ensure tiles exist for any map already on disk ─────
function _backgroundTileSweep() {
  if (!_tiler) return;
  const jobs = [];
  // World map(s): data/maps/swordcoast/*.jpg
  try {
    const swDir = path.join(MAPS_DIR, 'swordcoast');
    if (fs.existsSync(swDir)) {
      for (const f of fs.readdirSync(swDir)) {
        if (!/\.(jpe?g|png|webp)$/i.test(f)) continue;
        const base = path.basename(f, path.extname(f));
        jobs.push({ mapId: `swordcoast/${base}`, src: path.join(swDir, f) });
      }
    }
  } catch (_) {}
  // Local maps: data/maps/local/<locId>/map.*
  try {
    if (fs.existsSync(LOCAL_MAPS_DIR)) {
      for (const locId of fs.readdirSync(LOCAL_MAPS_DIR)) {
        const locDir = path.join(LOCAL_MAPS_DIR, locId);
        if (!fs.statSync(locDir).isDirectory()) continue;
        const files = fs.readdirSync(locDir).filter(f => /^map\.(jpe?g|png|webp)$/i.test(f));
        if (files.length) jobs.push({ mapId: `local/${locId}`, src: path.join(locDir, files[0]) });
      }
    }
  } catch (_) {}
  // Run sequentially to avoid hammering CPU on startup
  (async () => {
    for (const j of jobs) {
      try { await _tiler.buildFor(j.mapId, j.src); }
      catch (e) { console.warn(`[tiles] ${j.mapId}: ${e.message}`); }
    }
  })();
}

app.listen(PORT, () => {
  console.log(`Tiamat running on http://localhost:${PORT}`);
  _backgroundTileSweep();
});

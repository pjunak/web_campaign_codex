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
const WEB_DIR        = path.join(__dirname, 'web');

fs.mkdirSync(DATA_DIR,       { recursive: true });
fs.mkdirSync(PORTRAITS_DIR,  { recursive: true });
fs.mkdirSync(LOCAL_MAPS_DIR, { recursive: true });
fs.mkdirSync(TILES_DIR,      { recursive: true });

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
  'historicalEvents',
]);
const ALL_TYPES = [
  'characters', 'relationships', 'locations', 'events',
  'mysteries', 'factions', 'deletedDefaults',
  'species', 'pantheon', 'artifacts', 'settings',
  'historicalEvents',
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
    // Keyed-object collections: factions (id → record) and settings
    // (category → array). Everything else is an entity list.
    let container = (type === 'factions' || type === 'settings') ? {} : [];
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

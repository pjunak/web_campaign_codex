const express      = require('express');
const multer       = require('multer');
const archiver     = require('archiver');
const fs           = require('fs');
const path         = require('path');
const crypto       = require('crypto');
const cookieParser = require('cookie-parser');

const app  = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR      = path.join(__dirname, 'data');
const PORTRAITS_DIR = path.join(__dirname, 'data', 'portraits');
const MAPS_DIR      = path.join(__dirname, 'data', 'maps');
const LOCAL_MAPS_DIR = path.join(MAPS_DIR, 'local');
const WEB_DIR       = path.join(__dirname, 'web');

fs.mkdirSync(DATA_DIR,       { recursive: true });
fs.mkdirSync(PORTRAITS_DIR,  { recursive: true });
fs.mkdirSync(LOCAL_MAPS_DIR, { recursive: true });

app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));

const requireAuth = (req, res, next) => {
  const pwd          = process.env.EDIT_PASSWORD || '123';
  const expectedHash = crypto.createHash('sha256').update(pwd).digest('hex');
  if (req.cookies.edit_session === expectedHash) return next();
  res.status(401).json({ error: 'Neznámé nebo chybějící heslo.' });
};

app.use('/portraits', express.static(PORTRAITS_DIR));
app.use('/maps',      express.static(path.join(DATA_DIR, 'maps')));
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

function _dataHash() {
  try {
    let combinedSize = 0;
    let maxMtime     = 0;
    fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json')).forEach(f => {
      const stat = fs.statSync(path.join(DATA_DIR, f));
      combinedSize += stat.size;
      if (stat.mtimeMs > maxMtime) maxMtime = stat.mtimeMs;
    });
    return `${maxMtime}-${combinedSize}`;
  } catch {
    return 'none';
  }
}

function getFile(type) {
  const safeType = (type || '').replace(/[^a-z0-9_]/gi, '');
  return path.join(DATA_DIR, safeType + '.json');
}

// ── SSE broadcast (Phase 5.1) ────────────────────────────────────
// Clients subscribe to GET /api/events; on every successful write we
// push { type:'data-changed', hash } so they can refetch in <1s
// instead of waiting up to 30s for the next poll.
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

// ── Validation enums (Phase 5.2) ─────────────────────────────────
// Defense in depth: reject unknown collection names, relationship types,
// and character statuses at the API boundary. Clients should never
// produce these, but a buggy build or a hand-crafted PATCH could.
// `mapPins` is DEPRECATED. Pins were folded into `locations` (every
// Location can carry x/y/pinType/mapStatus/priority/parentId/localMap).
// The collection name is still allowed so legacy data files can be read
// and the client-side migration (Store._migrateMapPins) can write the
// emptied array back. Drop after one full deploy cycle.
const ALLOWED_TYPES = new Set([
  'characters', 'relationships', 'locations', 'events',
  'mysteries', 'mapPins', 'factions', 'deletedDefaults',
  'species', 'pantheon', 'artifacts', 'settings',
]);
// Enum validation (relationship type / character status / artifact
// state) was moved to the `settings` collection; server trusts the
// client to send valid ids. Structural validation (collection name,
// action) stays here.

app.get('/api/data', (_req, res) => {
  try {
    const types    = ['characters', 'relationships', 'locations', 'events', 'mysteries', 'mapPins', 'factions', 'deletedDefaults', 'species', 'pantheon', 'artifacts', 'settings'];
    const campaign = {};
    let foundAny   = false;
    for (const t of types) {
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

app.post('/api/login', (req, res) => {
  const { password } = req.body;
  const pwd = process.env.EDIT_PASSWORD || '123';
  if (password === pwd) {
    const token = crypto.createHash('sha256').update(pwd).digest('hex');
    res.cookie('edit_session', token, { httpOnly: true, path: '/' });
    res.json({ ok: true });
  } else {
    res.status(401).json({ error: 'Špatné heslo' });
  }
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
      if (typeof value === 'object') fs.writeFileSync(getFile(key), JSON.stringify(value, null, 2), 'utf8');
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
    const { type, action, payload } = req.body;

    // Validation (Phase 5.2)
    if (!ALLOWED_TYPES.has(type)) {
      return res.status(400).json({ error: `Unknown collection: ${type}` });
    }
    if (action !== 'save' && action !== 'delete') {
      return res.status(400).json({ error: `Unknown action: ${action}` });
    }
    // Enum validation (relationship type, character status, artifact
    // state) now lives in the client-side `settings` collection.

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
              fs.writeFileSync(relP, JSON.stringify(rels, null, 2), 'utf8');
            }
            const evtP = getFile('events');
            if (fs.existsSync(evtP)) {
              let evts = JSON.parse(fs.readFileSync(evtP, 'utf8'));
              if (evts.some(e => (e.characters || []).includes(payload.id))) {
                evts = evts.map(e => ({ ...e, characters: (e.characters || []).filter(cid => cid !== payload.id) }));
                fs.writeFileSync(evtP, JSON.stringify(evts, null, 2), 'utf8');
              }
            }
            const mysP = getFile('mysteries');
            if (fs.existsSync(mysP)) {
              let mys = JSON.parse(fs.readFileSync(mysP, 'utf8'));
              if (mys.some(m => (m.characters || []).includes(payload.id))) {
                mys = mys.map(m => ({ ...m, characters: (m.characters || []).filter(cid => cid !== payload.id) }));
                fs.writeFileSync(mysP, JSON.stringify(mys, null, 2), 'utf8');
              }
            }
          }
        }
      } else {
        delete container[payload.id];
      }
    }

    fs.writeFileSync(p, JSON.stringify(container, null, 2), 'utf8');
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
// Replaces 30s /api/version polling. Server pushes a 'data-changed'
// event after every successful write; clients refetch immediately.
app.get('/api/events', (req, res) => {
  res.set({
    'Content-Type':      'text/event-stream',
    'Cache-Control':     'no-cache, no-transform',
    'Connection':        'keep-alive',
    'X-Accel-Buffering': 'no', // disable nginx/proxy buffering
  });
  res.flushHeaders?.();
  // Initial hello so the client confirms the channel is open
  res.write(`event: hello\ndata: ${JSON.stringify({ hash: _dataHash(), at: Date.now() })}\n\n`);
  _sseClients.add(res);

  // Periodic ping (every 25 s) keeps proxies from closing the idle socket
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
  res.json({ url: `/maps/local/${locId}/${req.file.filename}` });
});

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

app.listen(PORT, () => {
  console.log(`Tiamat running on http://localhost:${PORT}`);
});

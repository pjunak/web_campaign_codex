'use strict';

// Integration: the startup visibility migration.
// Boots the server with un-stamped legacy data files seeded into
// the temp data dir, then verifies the migration:
//   1. Stamps `visibility:'public'` + `secrets:{}` on every existing
//      record across every visibility-bearing collection.
//   2. Takes a single snapshot labelled `reason: 'migration'`.
//   3. Is idempotent — second boot adds zero records, takes no
//      additional snapshot.
//   4. Treats records that already carry the fields as a no-op
//      (no spurious writes).
//   5. Skips non-visibility-bearing collections (settings, campaign,
//      deletedDefaults).

const { test }   = require('node:test');
const assert     = require('node:assert/strict');
const fs         = require('fs');
const fsp        = fs.promises;
const path       = require('path');
const { startServer } = require('./helpers/server-process.cjs');

const DM     = 'dm-pw';
const PLAYER = 'player-pw';

async function readJson(file) {
  return JSON.parse(await fsp.readFile(file, 'utf8'));
}

async function listSnapshots(snapshotsDir) {
  try {
    const all = await fsp.readdir(snapshotsDir);
    return all.filter(f => /^snapshot-.*\.json$/.test(f)).sort();
  } catch (_) { return []; }
}

test('migration: stamps visibility:public + secrets:{} on every legacy record', async () => {
  const srv = await startServer({
    dmPassword: DM, playerPassword: PLAYER,
    seedData: {
      // Pre-DM-mode data — no visibility, no secrets.
      'characters.json': [
        { id: 'a', name: 'Alice', faction: 'neutral' },
        { id: 'b', name: 'Bob',   faction: 'cult' },
      ],
      'locations.json': [
        { id: 'tavern', name: 'Inn', region: 'Greenest' },
      ],
      'factions.json': {
        neutral: { id: 'neutral', name: 'Neutral' },
        cult:    { id: 'cult',    name: 'Cult' },
      },
      'historicalEvents.json': [
        { id: 'fall', name: 'Fall of Netheril', summary: 'Long ago.' },
      ],
    },
  });
  try {
    // After boot, every seed record should carry the canonical fields.
    const chars = await readJson(path.join(srv.dataDir, 'characters.json'));
    for (const c of chars) {
      assert.equal(c.visibility, 'public', `character ${c.id} missing visibility`);
      assert.deepEqual(c.secrets, {},      `character ${c.id} missing secrets`);
    }
    const locs = await readJson(path.join(srv.dataDir, 'locations.json'));
    assert.equal(locs[0].visibility, 'public');
    assert.deepEqual(locs[0].secrets, {});

    // Keyed-object collection — values, not the container, are stamped.
    const facs = await readJson(path.join(srv.dataDir, 'factions.json'));
    for (const id of Object.keys(facs)) {
      assert.equal(facs[id].visibility, 'public', `faction ${id} missing visibility`);
      assert.deepEqual(facs[id].secrets, {});
    }
    const hist = await readJson(path.join(srv.dataDir, 'historicalEvents.json'));
    assert.equal(hist[0].visibility, 'public');
    assert.deepEqual(hist[0].secrets, {});
  } finally { await srv.kill(); }
});

test('migration: creates one snapshot labelled reason=migration when records were touched', async () => {
  const srv = await startServer({
    dmPassword: DM, playerPassword: PLAYER,
    seedData: {
      'characters.json': [{ id: 'a', name: 'Alice', faction: 'neutral' }],
    },
  });
  try {
    const snaps = await listSnapshots(srv.snapshotsDir);
    assert.equal(snaps.length, 1, 'expected exactly one migration snapshot');
    const snap = await readJson(path.join(srv.snapshotsDir, snaps[0]));
    assert.equal(snap.reason, 'migration');
    // Snapshot captures POST-migration state, so chars in the snapshot
    // should already carry the new fields.
    assert.equal(snap.files['characters.json'][0].visibility, 'public');
  } finally { await srv.kill(); }
});

test('migration: idempotent — already-stamped data triggers no writes, no snapshot', async () => {
  const srv = await startServer({
    dmPassword: DM, playerPassword: PLAYER,
    seedData: {
      // Pre-stamped data simulates a second boot after migration ran.
      'characters.json': [
        { id: 'a', name: 'Alice', faction: 'neutral', visibility: 'public', secrets: {} },
      ],
    },
  });
  try {
    const snaps = await listSnapshots(srv.snapshotsDir);
    assert.equal(snaps.length, 0, 'no records changed → no migration snapshot');
  } finally { await srv.kill(); }
});

test('migration: empty data dir is a no-op (no snapshot taken)', async () => {
  // Fresh install — no JSON files at all. Migration should skip
  // each ENOENT gracefully and not snapshot.
  const srv = await startServer({ dmPassword: DM, playerPassword: PLAYER });
  try {
    const snaps = await listSnapshots(srv.snapshotsDir);
    assert.equal(snaps.length, 0);
  } finally { await srv.kill(); }
});

test('migration: does NOT touch settings / deletedDefaults / campaign collections', async () => {
  // Excluded collections are inherently shared metadata; migration
  // must not stamp them with a `visibility` field that would
  // confuse the filter.
  const srv = await startServer({
    dmPassword: DM, playerPassword: PLAYER,
    seedData: {
      'settings.json':         { attitudes: [{ id: 'ally', label: 'A' }] },
      'deletedDefaults.json':  { 'old_id': true },
      'campaign.json':         { main: { name: 'Test', tagline: '' } },
    },
  });
  try {
    const settings = await readJson(path.join(srv.dataDir, 'settings.json'));
    // The TOP-LEVEL settings object must NOT have visibility/secrets stamped.
    assert.equal(Object.prototype.hasOwnProperty.call(settings, 'visibility'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(settings, 'secrets'),    false);

    const campaign = await readJson(path.join(srv.dataDir, 'campaign.json'));
    // Campaign's `main` record must not be stamped either (excluded).
    assert.equal(Object.prototype.hasOwnProperty.call(campaign.main, 'visibility'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(campaign.main, 'secrets'),    false);

    const tombstones = await readJson(path.join(srv.dataDir, 'deletedDefaults.json'));
    // Each tombstone is a primitive (true), not an object → migration
    // would skip it anyway, but verify the shape is preserved.
    assert.deepEqual(tombstones, { 'old_id': true });
  } finally { await srv.kill(); }
});

test('migration: preserves existing visibility:dm + secrets values', async () => {
  // If a record already has visibility:'dm', migration must NOT
  // overwrite it back to public.
  const srv = await startServer({
    dmPassword: DM, playerPassword: PLAYER,
    seedData: {
      'characters.json': [
        // Has visibility but missing secrets — migration adds secrets only.
        { id: 'preset_dm',  name: 'X', faction: 'cult', visibility: 'dm' },
        // Has secrets but missing visibility — migration adds visibility only.
        { id: 'preset_sec', name: 'Y', faction: 'neutral', secrets: { description: true } },
      ],
    },
  });
  try {
    const chars = await readJson(path.join(srv.dataDir, 'characters.json'));
    const presetDm  = chars.find(c => c.id === 'preset_dm');
    const presetSec = chars.find(c => c.id === 'preset_sec');
    assert.equal(presetDm.visibility,  'dm',     'pre-existing visibility:dm preserved');
    assert.deepEqual(presetDm.secrets, {},       'missing secrets backfilled');
    assert.equal(presetSec.visibility, 'public', 'missing visibility backfilled to public');
    assert.deepEqual(presetSec.secrets, { description: true }, 'pre-existing secrets preserved');
  } finally { await srv.kill(); }
});

test('migration: covers every visibility-bearing collection (no silent omissions)', async () => {
  // Build a synthetic seed with one un-stamped record per visibility-
  // bearing collection. After migration, every record should be
  // stamped — proves the migration's collection list is in sync with
  // VISIBILITY_BEARING.
  const { VISIBILITY_BEARING, KEYED_OBJ_VISIBILITY } = require('../server/visibility.cjs');
  const seed = {};
  for (const collection of VISIBILITY_BEARING) {
    if (collection === 'relationships') {
      seed['relationships.json'] = [
        { source: 'a', target: 'b', type: 'ally' },
      ];
    } else if (KEYED_OBJ_VISIBILITY.has(collection)) {
      seed[`${collection}.json`] = { 'unstamped': { id: 'unstamped', name: 'X' } };
    } else {
      seed[`${collection}.json`] = [{ id: 'unstamped', name: 'X' }];
    }
  }
  const srv = await startServer({ dmPassword: DM, playerPassword: PLAYER, seedData: seed });
  try {
    for (const collection of VISIBILITY_BEARING) {
      const file = path.join(srv.dataDir, `${collection}.json`);
      const data = await readJson(file);
      const entries = Array.isArray(data) ? data : Object.values(data);
      for (const e of entries) {
        assert.equal(e.visibility, 'public', `${collection} entity missing visibility post-migration`);
        assert.deepEqual(e.secrets, {},      `${collection} entity missing secrets post-migration`);
      }
    }
  } finally { await srv.kill(); }
});

test('migration: corrupt JSON file is skipped with a warning, server still boots', async () => {
  const srv = await startServer({
    dmPassword: DM, playerPassword: PLAYER,
    seedData: {
      // Intentionally malformed JSON — migration must not crash.
      'characters.json': '{not valid json',
      'locations.json':  [{ id: 'a', name: 'OK' }],
    },
  });
  try {
    // Server is up (waitForReady passed in startServer).
    const res = await srv.fetch('/api/version');
    assert.equal(res.status, 200);
    // The good file got migrated.
    const locs = await readJson(path.join(srv.dataDir, 'locations.json'));
    assert.equal(locs[0].visibility, 'public');
  } finally { await srv.kill(); }
});

test('migration: preserves all other entity fields verbatim', async () => {
  // Make sure the migration doesn't drop or rename anything beyond
  // the two new fields it adds.
  const original = {
    id: 'frulam',
    name: 'Frulam Mondath',
    faction: 'cult_high',
    title: 'Wearer of Purple',
    description: 'A wyrmspeaker.',
    portrait: '/portraits/frulam/portrait.png',
    knowledge: 3,
    tags: ['cult', 'wyrmspeaker'],
    locationRoles: [{ locationId: 'temple', role: 'leader' }],
    updatedAt: 1700000000000,
  };
  const srv = await startServer({
    dmPassword: DM, playerPassword: PLAYER,
    seedData: { 'characters.json': [original] },
  });
  try {
    const chars = await readJson(path.join(srv.dataDir, 'characters.json'));
    const after = chars[0];
    // Spread + the two new fields = the full original.
    assert.deepEqual(after, { ...original, visibility: 'public', secrets: {} });
  } finally { await srv.kill(); }
});

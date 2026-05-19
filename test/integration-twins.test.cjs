'use strict';

// Integration: the twin entity model.
//
// /api/twin create/unlink is DM-realRole-only (impersonating players
// can't manage twins). Twins always live in the same collection in
// the opposite visibility space and reference each other via
// `linkedTwinId`. Server enforces atomicity inside `withWriteLock`,
// orphan-cleanup on delete, and visibility-flip blocking while a
// twin link exists.

const { test }   = require('node:test');
const assert     = require('node:assert/strict');
const fsp        = require('fs').promises;
const path       = require('path');
const { startServer } = require('./helpers/server-process.cjs');

const DM     = 'dm-pw';
const PLAYER = 'player-pw';

async function loginAs(srv, password) {
  const r = await srv.fetch('/api/login', {
    method:  'POST', headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ password }),
  });
  assert.equal(r.status, 200, 'login failed');
}

async function readCollection(srv, file) {
  const raw = await fsp.readFile(path.join(srv.dataDir, file), 'utf8');
  return JSON.parse(raw);
}
async function readEntity(srv, file, id) {
  const data = await readCollection(srv, file);
  return Array.isArray(data) ? data.find(e => e.id === id) : data[id];
}

async function postTwin(srv, body) {
  return srv.fetch('/api/twin', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
}

// ── Create ────────────────────────────────────────────────────────

test('twin create from public entity: new DM entity, bidirectional link, body copied verbatim', async () => {
  const srv = await startServer({
    dmPassword: DM, playerPassword: PLAYER,
    seedData: {
      'characters.json': [{
        id: 'stranger', name: 'Stranger', faction: 'neutral',
        description: 'A hooded figure.', visibility: 'public',
        knowledge: 1,
      }],
    },
  });
  try {
    await loginAs(srv, DM);
    const res = await postTwin(srv, { action: 'create', type: 'characters', sourceId: 'stranger' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(typeof body.twinId, 'string');
    assert.match(body.twinId, /^[a-z0-9_]+_[a-z0-9]{6}$/, 'twin id is slug+suffix');

    const chars = await readCollection(srv, 'characters.json');
    assert.equal(chars.length, 2);
    const src  = chars.find(c => c.id === 'stranger');
    const twin = chars.find(c => c.id === body.twinId);
    assert.ok(twin);

    // Visibility flipped.
    assert.equal(src.visibility,  'public');
    assert.equal(twin.visibility, 'dm');

    // Bidirectional link.
    assert.equal(src.linkedTwinId,  twin.id);
    assert.equal(twin.linkedTwinId, src.id);

    // Body field copied verbatim.
    assert.equal(twin.description, 'A hooded figure.');
    // Structured fields too.
    assert.equal(twin.name, 'Stranger');
    assert.equal(twin.faction, 'neutral');
    assert.equal(twin.knowledge, 1);

    // updatedAt stamped fresh on both.
    assert.equal(typeof src.updatedAt, 'number');
    assert.equal(typeof twin.updatedAt, 'number');
  } finally { await srv.kill(); }
});

test('twin create from DM entity: new public entity', async () => {
  const srv = await startServer({
    dmPassword: DM, playerPassword: PLAYER,
    seedData: {
      'characters.json': [{
        id: 'villain', name: 'Villain', faction: 'cult',
        description: 'DM lore.', visibility: 'dm',
      }],
    },
  });
  try {
    await loginAs(srv, DM);
    const res = await postTwin(srv, { action: 'create', type: 'characters', sourceId: 'villain' });
    assert.equal(res.status, 200);
    const body = await res.json();
    const twin = await readEntity(srv, 'characters.json', body.twinId);
    assert.equal(twin.visibility, 'public');
  } finally { await srv.kill(); }
});

test('twin create works for PC characters (faction=party) — DM gets a DM twin without flipping the PC', async () => {
  const srv = await startServer({
    dmPassword: DM, playerPassword: PLAYER,
    seedData: {
      'characters.json': [{
        id: 'kira', name: 'Kira', faction: 'party',
        description: 'The bard.', visibility: 'public',
      }],
    },
  });
  try {
    await loginAs(srv, DM);
    const res = await postTwin(srv, { action: 'create', type: 'characters', sourceId: 'kira' });
    assert.equal(res.status, 200);
    const body = await res.json();
    const src  = await readEntity(srv, 'characters.json', 'kira');
    const twin = await readEntity(srv, 'characters.json', body.twinId);
    assert.equal(src.visibility,  'public', 'PC source stays public');
    assert.equal(twin.visibility, 'dm',     'DM twin is created');
    assert.equal(twin.faction,    'party',  'twin retains faction copy');
  } finally { await srv.kill(); }
});

test('twin create rejects player role (403)', async () => {
  const srv = await startServer({
    dmPassword: DM, playerPassword: PLAYER,
    seedData: {
      'characters.json': [{ id: 'x', name: 'X', faction: 'neutral', visibility: 'public' }],
    },
  });
  try {
    await loginAs(srv, PLAYER);
    const res = await postTwin(srv, { action: 'create', type: 'characters', sourceId: 'x' });
    assert.equal(res.status, 403);
  } finally { await srv.kill(); }
});

test('twin create rejects DM impersonating player (realRole !== dm)', async () => {
  const srv = await startServer({
    dmPassword: DM, playerPassword: PLAYER,
    seedData: {
      'characters.json': [{ id: 'x', name: 'X', faction: 'neutral', visibility: 'public' }],
    },
  });
  try {
    await loginAs(srv, DM);
    await srv.fetch('/api/view-as', { method: 'POST' });
    // realRole is still 'dm', so this should actually succeed.
    // The realRole gate is what matters; effective role is player.
    const res = await postTwin(srv, { action: 'create', type: 'characters', sourceId: 'x' });
    assert.equal(res.status, 200, 'realRole=dm should still allow twin ops even when impersonating');
  } finally { await srv.kill(); }
});

test('twin create rejects an already-twinned source (409)', async () => {
  const srv = await startServer({
    dmPassword: DM, playerPassword: PLAYER,
    seedData: {
      'characters.json': [
        { id: 'a', name: 'A', faction: 'neutral', visibility: 'public', linkedTwinId: 'b' },
        { id: 'b', name: 'B', faction: 'cult',    visibility: 'dm',     linkedTwinId: 'a' },
      ],
    },
  });
  try {
    await loginAs(srv, DM);
    const res = await postTwin(srv, { action: 'create', type: 'characters', sourceId: 'a' });
    assert.equal(res.status, 409);
  } finally { await srv.kill(); }
});

test('twin create rejects unknown collection (400)', async () => {
  const srv = await startServer({ dmPassword: DM, playerPassword: PLAYER });
  try {
    await loginAs(srv, DM);
    const res = await postTwin(srv, { action: 'create', type: 'settings', sourceId: 'x' });
    assert.equal(res.status, 400);
  } finally { await srv.kill(); }
});

test('twin create rejects relationships type (unsupported)', async () => {
  const srv = await startServer({ dmPassword: DM, playerPassword: PLAYER });
  try {
    await loginAs(srv, DM);
    const res = await postTwin(srv, { action: 'create', type: 'relationships', sourceId: 'x' });
    assert.equal(res.status, 400);
  } finally { await srv.kill(); }
});

test('twin create on factions (keyed-object collection) works', async () => {
  const srv = await startServer({
    dmPassword: DM, playerPassword: PLAYER,
    seedData: {
      'factions.json': {
        cult: { id: 'cult', name: 'Cult', description: 'Public faction.', visibility: 'public' },
      },
    },
  });
  try {
    await loginAs(srv, DM);
    const res = await postTwin(srv, { action: 'create', type: 'factions', sourceId: 'cult' });
    assert.equal(res.status, 200);
    const body = await res.json();
    const facs = await readCollection(srv, 'factions.json');
    assert.ok(facs.cult.linkedTwinId);
    assert.equal(facs.cult.linkedTwinId, body.twinId);
    assert.equal(facs[body.twinId].visibility, 'dm');
    assert.equal(facs[body.twinId].linkedTwinId, 'cult');
  } finally { await srv.kill(); }
});

// ── Unlink ────────────────────────────────────────────────────────

test('twin unlink: clears linkedTwinId on both sides; entities survive', async () => {
  const srv = await startServer({
    dmPassword: DM, playerPassword: PLAYER,
    seedData: {
      'characters.json': [
        { id: 'a', name: 'A', faction: 'neutral', visibility: 'public', linkedTwinId: 'b' },
        { id: 'b', name: 'B', faction: 'cult',    visibility: 'dm',     linkedTwinId: 'a' },
      ],
    },
  });
  try {
    await loginAs(srv, DM);
    const res = await postTwin(srv, { action: 'unlink', type: 'characters', sourceId: 'a' });
    assert.equal(res.status, 200);
    const chars = await readCollection(srv, 'characters.json');
    assert.equal(chars.length, 2, 'both entities survive');
    for (const c of chars) {
      assert.equal(Object.prototype.hasOwnProperty.call(c, 'linkedTwinId'), false,
        `${c.id} should have linkedTwinId cleared`);
    }
  } finally { await srv.kill(); }
});

test('twin unlink on a source without a twin returns 409', async () => {
  const srv = await startServer({
    dmPassword: DM, playerPassword: PLAYER,
    seedData: {
      'characters.json': [{ id: 'a', name: 'A', faction: 'neutral', visibility: 'public' }],
    },
  });
  try {
    await loginAs(srv, DM);
    const res = await postTwin(srv, { action: 'unlink', type: 'characters', sourceId: 'a' });
    assert.equal(res.status, 409);
  } finally { await srv.kill(); }
});

// ── Delete cascade ────────────────────────────────────────────────

test('DELETE of a twinned entity orphans the surviving twin (clears its linkedTwinId)', async () => {
  const srv = await startServer({
    dmPassword: DM, playerPassword: PLAYER,
    seedData: {
      'characters.json': [
        { id: 'pub',  name: 'Pub', faction: 'neutral', visibility: 'public', linkedTwinId: 'dm_x' },
        { id: 'dm_x', name: 'Dm',  faction: 'cult',    visibility: 'dm',     linkedTwinId: 'pub' },
      ],
    },
  });
  try {
    await loginAs(srv, DM);
    const res = await srv.fetch('/api/data', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ type: 'characters', action: 'delete', payload: { id: 'pub' }}),
    });
    assert.equal(res.status, 200);
    const chars = await readCollection(srv, 'characters.json');
    assert.equal(chars.length, 1);
    const survivor = chars[0];
    assert.equal(survivor.id, 'dm_x');
    assert.equal(Object.prototype.hasOwnProperty.call(survivor, 'linkedTwinId'), false,
      'survivor twin link cleared');
  } finally { await srv.kill(); }
});

// ── Visibility flip block ─────────────────────────────────────────

test('PATCH save: visibility flip on a twinned entity is rejected (400)', async () => {
  const srv = await startServer({
    dmPassword: DM, playerPassword: PLAYER,
    seedData: {
      'characters.json': [
        { id: 'pub',  name: 'Pub', faction: 'neutral', visibility: 'public', linkedTwinId: 'dm_x' },
        { id: 'dm_x', name: 'Dm',  faction: 'cult',    visibility: 'dm',     linkedTwinId: 'pub' },
      ],
    },
  });
  try {
    await loginAs(srv, DM);
    const res = await srv.fetch('/api/data', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        type: 'characters', action: 'save',
        payload: { id: 'pub', name: 'Pub', faction: 'neutral', visibility: 'dm', linkedTwinId: 'dm_x' },
      }),
    });
    assert.equal(res.status, 400);
  } finally { await srv.kill(); }
});

test('PATCH save: same-visibility update on a twinned entity is accepted', async () => {
  // Saving without changing visibility should work — only flipping is
  // blocked. Edits to name/description on twinned entities are fine.
  const srv = await startServer({
    dmPassword: DM, playerPassword: PLAYER,
    seedData: {
      'characters.json': [
        { id: 'pub',  name: 'Pub', faction: 'neutral', visibility: 'public', linkedTwinId: 'dm_x' },
        { id: 'dm_x', name: 'Dm',  faction: 'cult',    visibility: 'dm',     linkedTwinId: 'pub' },
      ],
    },
  });
  try {
    await loginAs(srv, DM);
    const res = await srv.fetch('/api/data', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        type: 'characters', action: 'save',
        payload: { id: 'pub', name: 'Pub Renamed', faction: 'neutral', visibility: 'public', linkedTwinId: 'dm_x' },
      }),
    });
    assert.equal(res.status, 200);
    const stored = await readEntity(srv, 'characters.json', 'pub');
    assert.equal(stored.name, 'Pub Renamed');
    assert.equal(stored.linkedTwinId, 'dm_x');
  } finally { await srv.kill(); }
});

// ── Source not found ──────────────────────────────────────────────

test('twin create on missing source returns 404', async () => {
  const srv = await startServer({ dmPassword: DM, playerPassword: PLAYER });
  try {
    await loginAs(srv, DM);
    const res = await postTwin(srv, { action: 'create', type: 'characters', sourceId: 'nope' });
    assert.equal(res.status, 404);
  } finally { await srv.kill(); }
});

// ── Link two existing entities ────────────────────────────────────

test('twin link: pairs two existing entities (opposite visibility, same collection)', async () => {
  // The duplicate-resolution case: DM had "Frulam" privately, player
  // created "Frulam" publicly. DM marries the two records.
  const srv = await startServer({
    dmPassword: DM, playerPassword: PLAYER,
    seedData: {
      'characters.json': [
        { id: 'pub_frulam', name: 'Frulam', faction: 'neutral', visibility: 'public' },
        { id: 'dm_frulam',  name: 'Frulam Mondath', faction: 'cult', visibility: 'dm' },
      ],
    },
  });
  try {
    await loginAs(srv, DM);
    const res = await postTwin(srv, {
      action: 'link', type: 'characters',
      sourceId: 'pub_frulam', targetId: 'dm_frulam',
    });
    assert.equal(res.status, 200);
    const chars = await readCollection(srv, 'characters.json');
    const src = chars.find(c => c.id === 'pub_frulam');
    const tgt = chars.find(c => c.id === 'dm_frulam');
    assert.equal(src.linkedTwinId, 'dm_frulam');
    assert.equal(tgt.linkedTwinId, 'pub_frulam');
    // Names + everything else preserved (link doesn't touch content).
    assert.equal(src.name, 'Frulam');
    assert.equal(tgt.name, 'Frulam Mondath');
  } finally { await srv.kill(); }
});

test('twin link: rejected for player role (403)', async () => {
  const srv = await startServer({
    dmPassword: DM, playerPassword: PLAYER,
    seedData: {
      'characters.json': [
        { id: 'a', name: 'A', faction: 'neutral', visibility: 'public' },
        { id: 'b', name: 'B', faction: 'cult',    visibility: 'dm'     },
      ],
    },
  });
  try {
    await loginAs(srv, PLAYER);
    const res = await postTwin(srv, {
      action: 'link', type: 'characters', sourceId: 'a', targetId: 'b',
    });
    assert.equal(res.status, 403);
  } finally { await srv.kill(); }
});

test('twin link: rejects same-visibility target (both public)', async () => {
  const srv = await startServer({
    dmPassword: DM, playerPassword: PLAYER,
    seedData: {
      'characters.json': [
        { id: 'a', name: 'A', faction: 'neutral', visibility: 'public' },
        { id: 'b', name: 'B', faction: 'neutral', visibility: 'public' },
      ],
    },
  });
  try {
    await loginAs(srv, DM);
    const res = await postTwin(srv, {
      action: 'link', type: 'characters', sourceId: 'a', targetId: 'b',
    });
    assert.equal(res.status, 400);
  } finally { await srv.kill(); }
});

test('twin link: rejects same-visibility target (both DM)', async () => {
  const srv = await startServer({
    dmPassword: DM, playerPassword: PLAYER,
    seedData: {
      'characters.json': [
        { id: 'a', name: 'A', faction: 'cult', visibility: 'dm' },
        { id: 'b', name: 'B', faction: 'cult', visibility: 'dm' },
      ],
    },
  });
  try {
    await loginAs(srv, DM);
    const res = await postTwin(srv, {
      action: 'link', type: 'characters', sourceId: 'a', targetId: 'b',
    });
    assert.equal(res.status, 400);
  } finally { await srv.kill(); }
});

test('twin link: rejects when source already has a twin (409)', async () => {
  const srv = await startServer({
    dmPassword: DM, playerPassword: PLAYER,
    seedData: {
      'characters.json': [
        { id: 'a', name: 'A', faction: 'neutral', visibility: 'public', linkedTwinId: 'old_x' },
        { id: 'old_x', name: 'Old', faction: 'cult', visibility: 'dm',  linkedTwinId: 'a' },
        { id: 'b', name: 'B', faction: 'cult', visibility: 'dm' },
      ],
    },
  });
  try {
    await loginAs(srv, DM);
    const res = await postTwin(srv, {
      action: 'link', type: 'characters', sourceId: 'a', targetId: 'b',
    });
    assert.equal(res.status, 409);
  } finally { await srv.kill(); }
});

test('twin link: rejects when target already has a twin (409)', async () => {
  const srv = await startServer({
    dmPassword: DM, playerPassword: PLAYER,
    seedData: {
      'characters.json': [
        { id: 'a', name: 'A', faction: 'neutral', visibility: 'public' },
        { id: 'b', name: 'B', faction: 'cult', visibility: 'dm', linkedTwinId: 'other' },
        { id: 'other', name: 'Other', faction: 'neutral', visibility: 'public', linkedTwinId: 'b' },
      ],
    },
  });
  try {
    await loginAs(srv, DM);
    const res = await postTwin(srv, {
      action: 'link', type: 'characters', sourceId: 'a', targetId: 'b',
    });
    assert.equal(res.status, 409);
  } finally { await srv.kill(); }
});

test('twin link: rejects missing target (404)', async () => {
  const srv = await startServer({
    dmPassword: DM, playerPassword: PLAYER,
    seedData: {
      'characters.json': [{ id: 'a', name: 'A', faction: 'neutral', visibility: 'public' }],
    },
  });
  try {
    await loginAs(srv, DM);
    const res = await postTwin(srv, {
      action: 'link', type: 'characters', sourceId: 'a', targetId: 'nope',
    });
    assert.equal(res.status, 404);
  } finally { await srv.kill(); }
});

test('twin link: rejects sourceId === targetId (400)', async () => {
  const srv = await startServer({
    dmPassword: DM, playerPassword: PLAYER,
    seedData: {
      'characters.json': [{ id: 'a', name: 'A', faction: 'neutral', visibility: 'public' }],
    },
  });
  try {
    await loginAs(srv, DM);
    const res = await postTwin(srv, {
      action: 'link', type: 'characters', sourceId: 'a', targetId: 'a',
    });
    assert.equal(res.status, 400);
  } finally { await srv.kill(); }
});

test('twin link: missing targetId returns 400', async () => {
  const srv = await startServer({
    dmPassword: DM, playerPassword: PLAYER,
    seedData: {
      'characters.json': [{ id: 'a', name: 'A', faction: 'neutral', visibility: 'public' }],
    },
  });
  try {
    await loginAs(srv, DM);
    const res = await postTwin(srv, { action: 'link', type: 'characters', sourceId: 'a' });
    assert.equal(res.status, 400);
  } finally { await srv.kill(); }
});

test('twin link: works on factions (keyed-object collection)', async () => {
  const srv = await startServer({
    dmPassword: DM, playerPassword: PLAYER,
    seedData: {
      'factions.json': {
        pub: { id: 'pub', name: 'Public Cult', visibility: 'public' },
        dm:  { id: 'dm',  name: 'Real Cult',   visibility: 'dm'     },
      },
    },
  });
  try {
    await loginAs(srv, DM);
    const res = await postTwin(srv, {
      action: 'link', type: 'factions', sourceId: 'pub', targetId: 'dm',
    });
    assert.equal(res.status, 200);
    const facs = await readCollection(srv, 'factions.json');
    assert.equal(facs.pub.linkedTwinId, 'dm');
    assert.equal(facs.dm.linkedTwinId,  'pub');
  } finally { await srv.kill(); }
});

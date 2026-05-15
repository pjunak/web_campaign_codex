'use strict';

// Integration: end-to-end visibility filtering through the live
// HTTP stack. Boots the real server, seeds DM-only / per-field-
// secret / marker-laden records, and asserts that what reaches
// the player wire is what the spec demands.
//
// These tests are the load-bearing ones — if any of them fail the
// promise "players literally cannot see DM content via DevTools" is
// broken. Failures here block any deploy.

const { test }   = require('node:test');
const assert     = require('node:assert/strict');
const { startServer } = require('./helpers/server-process.cjs');

const DM     = 'dm-pw';
const PLAYER = 'player-pw';

// ── Helpers ───────────────────────────────────────────────────────

async function loginAs(srv, password) {
  const res = await srv.fetch('/api/login', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ password }),
  });
  assert.equal(res.status, 200, 'login failed');
}

async function fetchData(srv) {
  const res = await srv.fetch('/api/data');
  assert.equal(res.status, 200);
  return await res.json();
}

// Common seed: a public NPC, a DM-only NPC, an NPC with a secret
// description field, an NPC with [secret]…[/secret] marker prose.
function commonSeed() {
  return {
    'characters.json': [
      {
        id: 'pub_alice',
        name: 'Alice',
        faction: 'neutral',
        description: 'A merchant.',
        visibility: 'public',
        secrets: {},
      },
      {
        id: 'dm_villain',
        name: 'The Villain',
        faction: 'cult_high',
        description: 'Plot-twist material.',
        visibility: 'dm',
        secrets: {},
      },
      {
        id: 'pub_with_secret_field',
        name: 'Bob',
        faction: 'neutral',
        description: 'A fence in the market.',
        visibility: 'public',
        secrets: { description: true },
      },
      {
        id: 'pub_with_marker',
        name: 'Carol',
        faction: 'neutral',
        description: 'A guard. [secret]She is a doppelganger spy.[/secret] Friendly.',
        visibility: 'public',
        secrets: {},
      },
    ],
    'factions.json': {
      neutral:   { id: 'neutral',   name: 'Neutral',   description: 'Public.', visibility: 'public', secrets: {} },
      cult_high: { id: 'cult_high', name: 'Hidden Cult', description: 'DM-only fac.', visibility: 'dm', secrets: {} },
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────

test('GET /api/data: anonymous receives player-filtered payload', async () => {
  const srv = await startServer({ dmPassword: DM, playerPassword: PLAYER, seedData: commonSeed() });
  try {
    const data = await fetchData(srv);

    // DM-only entity is missing entirely.
    const ids = data.characters.map(c => c.id);
    assert.equal(ids.includes('dm_villain'), false, 'DM-only character must not leak to anonymous');
    assert.equal(ids.length, 3);

    // Per-field secret stripped.
    const bob = data.characters.find(c => c.id === 'pub_with_secret_field');
    assert.equal(Object.prototype.hasOwnProperty.call(bob, 'description'), false, 'secret field must be missing');

    // Marker prose stripped.
    const carol = data.characters.find(c => c.id === 'pub_with_marker');
    assert.equal(carol.description.includes('doppelganger'), false, 'secret marker prose must be stripped');
    assert.equal(carol.description.includes('[secret]'),     false);
    assert.equal(carol.description.includes('[/secret]'),    false);

    // DM-only faction is missing from the keyed-object payload.
    assert.equal(Object.prototype.hasOwnProperty.call(data.factions, 'cult_high'), false, 'DM-only faction must not leak');
    assert.equal(Object.prototype.hasOwnProperty.call(data.factions, 'neutral'),   true);
  } finally { await srv.kill(); }
});

test('GET /api/data: player session receives player-filtered payload', async () => {
  const srv = await startServer({ dmPassword: DM, playerPassword: PLAYER, seedData: commonSeed() });
  try {
    await loginAs(srv, PLAYER);
    const data = await fetchData(srv);
    const ids = data.characters.map(c => c.id);
    assert.equal(ids.includes('dm_villain'), false);
    assert.equal(ids.length, 3);
  } finally { await srv.kill(); }
});

test('GET /api/data: DM session receives EVERY entity, with markers intact', async () => {
  const srv = await startServer({ dmPassword: DM, playerPassword: PLAYER, seedData: commonSeed() });
  try {
    await loginAs(srv, DM);
    const data = await fetchData(srv);

    // All 4 characters present.
    assert.equal(data.characters.length, 4);
    const ids = data.characters.map(c => c.id).sort();
    assert.deepEqual(ids, ['dm_villain', 'pub_alice', 'pub_with_marker', 'pub_with_secret_field']);

    // DM-only faction present.
    assert.equal(Object.prototype.hasOwnProperty.call(data.factions, 'cult_high'), true);

    // Secret field is present on DM payload.
    const bob = data.characters.find(c => c.id === 'pub_with_secret_field');
    assert.equal(typeof bob.description, 'string');

    // Marker prose intact.
    const carol = data.characters.find(c => c.id === 'pub_with_marker');
    assert.equal(carol.description.includes('doppelganger'), true);
    assert.equal(carol.description.includes('[secret]'),     true);
  } finally { await srv.kill(); }
});

test('GET /api/data: DM impersonating player gets the player-filtered payload', async () => {
  // The whole point of impersonation: the DM can verify what leaks
  // without re-entering the password. Effective role drives filtering.
  const srv = await startServer({ dmPassword: DM, playerPassword: PLAYER, seedData: commonSeed() });
  try {
    await loginAs(srv, DM);
    await srv.fetch('/api/view-as', { method: 'POST' });
    const data = await fetchData(srv);
    const ids = data.characters.map(c => c.id);
    assert.equal(ids.includes('dm_villain'), false, 'impersonation must hide DM content');
    assert.equal(ids.length, 3);
  } finally { await srv.kill(); }
});

test('GET /api/data: raw bytes do NOT contain any secret substring (no DevTools leak)', async () => {
  // The headline guarantee. Snake-eats-tail check on the raw response
  // body — even string substrings of the secret prose must not appear.
  const srv = await startServer({ dmPassword: DM, playerPassword: PLAYER, seedData: commonSeed() });
  try {
    const res  = await srv.fetch('/api/data');
    const text = await res.text();
    assert.equal(text.includes('Plot-twist material'),                   false, 'DM-only entity description leaked');
    assert.equal(text.includes('She is a doppelganger spy'),             false, 'inline-marker prose leaked');
    assert.equal(text.includes('A fence in the market'),                 false, 'per-field secret leaked');
    assert.equal(text.includes('Hidden Cult'),                           false, 'DM-only faction name leaked');
    // Sanity: public content IS in the response.
    assert.equal(text.includes('A merchant'), true, 'expected public field to appear');
  } finally { await srv.kill(); }
});

test('PATCH+GET round-trip: DM creates a DM-only char, player view never sees it', async () => {
  const srv = await startServer({ dmPassword: DM, playerPassword: PLAYER });
  try {
    await loginAs(srv, DM);
    const patch = await srv.fetch('/api/data', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        type: 'characters', action: 'save',
        payload: {
          id: 'spy_42', name: 'Hidden Spy', faction: 'cult_high',
          description: 'Sold the queen out.',
          visibility: 'dm', secrets: {},
        },
      }),
    });
    assert.equal(patch.status, 200);

    // Same browser still has DM cookie → sees the spy.
    const dmData = await fetchData(srv);
    assert.equal(dmData.characters.find(c => c.id === 'spy_42').name, 'Hidden Spy');

    // Logout, hit /api/data anonymously → spy is gone.
    srv.clearCookies();
    const playerData = await fetchData(srv);
    assert.equal(playerData.characters.find(c => c.id === 'spy_42'), undefined);
    // Raw bytes also clean.
    const playerRaw = JSON.stringify(playerData);
    assert.equal(playerRaw.includes('Sold the queen out'), false);
    assert.equal(playerRaw.includes('Hidden Spy'),         false);
  } finally { await srv.kill(); }
});

test('PATCH /api/data: PC (faction=party) cannot be marked DM-only (server enforces)', async () => {
  const srv = await startServer({ dmPassword: DM, playerPassword: PLAYER });
  try {
    await loginAs(srv, DM);
    const res = await srv.fetch('/api/data', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        type: 'characters', action: 'save',
        payload: { id: 'pc_kira', name: 'Kira', faction: 'party', visibility: 'dm' },
      }),
    });
    assert.equal(res.status, 400, 'PC with visibility:dm must be rejected');
    const body = await res.json();
    assert.match(body.error, /PCs/);
  } finally { await srv.kill(); }
});

test('PATCH /api/data: PC with visibility=public is accepted', async () => {
  const srv = await startServer({ dmPassword: DM, playerPassword: PLAYER });
  try {
    await loginAs(srv, DM);
    const res = await srv.fetch('/api/data', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        type: 'characters', action: 'save',
        payload: { id: 'pc_kira', name: 'Kira', faction: 'party', visibility: 'public' },
      }),
    });
    assert.equal(res.status, 200);
  } finally { await srv.kill(); }
});

test('Player cannot read a DM-only entity even by guessing its id (no API to leak)', async () => {
  // There's no /api/character/:id endpoint — every read goes through
  // /api/data which is filtered. The SPA catch-all serves index.html
  // for any unknown URL (so any path under / returns 200), but the
  // body is HTML, not the entity JSON. This test asserts that the
  // entity's secret data never appears in any URL beyond /api/data.
  const srv = await startServer({ dmPassword: DM, playerPassword: PLAYER, seedData: commonSeed() });
  try {
    for (const ep of [
      '/api/data/characters/dm_villain',
      '/api/character/dm_villain',
      '/api/characters/dm_villain',
    ]) {
      const r    = await srv.fetch(ep);
      const body = await r.text();
      assert.equal(body.includes('Plot-twist material'), false, `${ep} body leaked DM data`);
      assert.equal(body.includes('The Villain'),         false, `${ep} body leaked DM data`);
    }
  } finally { await srv.kill(); }
});

test('Markers in non-allowlisted fields survive (literal text, no over-stripping)', async () => {
  // A faction's `name` legitimately could be "[secret]Cult[/secret]"
  // (silly example, but mechanically: `name` isn't in MARKDOWN_FIELDS
  // for factions, so the marker tokenizer must NOT touch it).
  const srv = await startServer({
    dmPassword: DM, playerPassword: PLAYER,
    seedData: {
      'factions.json': {
        weird: {
          id: 'weird',
          name: 'Project [secret]X[/secret]',  // literal brackets in name
          description: 'A faction.',
          visibility: 'public',
          secrets: {},
        },
      },
    },
  });
  try {
    const data = await fetchData(srv);
    assert.equal(data.factions.weird.name, 'Project [secret]X[/secret]', 'name field must not be marker-stripped');
  } finally { await srv.kill(); }
});

test('All visibility-bearing markdown fields strip [secret] markers in player payload', async () => {
  // Loop over every (collection, field) in MARKDOWN_FIELDS so we
  // catch any field that's listed in the allow-list but not actually
  // wired up server-side.
  const { MARKDOWN_FIELDS } = require('../server/visibility.cjs');
  const seed = {};
  for (const [collection, fields] of Object.entries(MARKDOWN_FIELDS)) {
    const entity = { id: collection + '_test', name: 'Test', visibility: 'public', secrets: {} };
    for (const f of fields) {
      entity[f] = `before [secret]LEAK_${collection}_${f}[/secret] after`;
    }
    seed[`${collection}.json`] = collection === 'factions' ? { [entity.id]: entity } : [entity];
  }
  const srv = await startServer({ dmPassword: DM, playerPassword: PLAYER, seedData: seed });
  try {
    const text = await (await srv.fetch('/api/data')).text();
    for (const [collection, fields] of Object.entries(MARKDOWN_FIELDS)) {
      for (const f of fields) {
        assert.equal(
          text.includes(`LEAK_${collection}_${f}`), false,
          `LEAK in ${collection}.${f} — server stripping is broken for that field`
        );
      }
    }
  } finally { await srv.kill(); }
});

test('Settings collection is not filtered (shared metadata)', async () => {
  // Settings, deletedDefaults, and campaign are excluded from the
  // visibility model. Putting visibility:'dm' on a settings record
  // should NOT cause the whole settings blob to disappear.
  const srv = await startServer({
    dmPassword: DM, playerPassword: PLAYER,
    seedData: {
      'settings.json': {
        attitudes: [{ id: 'ally', label: 'Spojenec' }],
        // Even if a category accidentally has a `visibility` key on
        // its array (it shouldn't), the filter is a no-op for settings.
      },
    },
  });
  try {
    const data = await fetchData(srv);
    assert.deepEqual(data.settings.attitudes, [{ id: 'ally', label: 'Spojenec' }]);
  } finally { await srv.kill(); }
});

test('Relationships participate in entity-level visibility', async () => {
  // A spoiler relationship between two public characters can itself
  // be DM-only. The plan added relationships to VISIBILITY_BEARING.
  const srv = await startServer({
    dmPassword: DM, playerPassword: PLAYER,
    seedData: {
      'characters.json': [
        { id: 'a', name: 'A', faction: 'neutral', visibility: 'public', secrets: {} },
        { id: 'b', name: 'B', faction: 'neutral', visibility: 'public', secrets: {} },
      ],
      'relationships.json': [
        { source: 'a', target: 'b', type: 'ally',     visibility: 'public', secrets: {} },
        { source: 'a', target: 'b', type: 'commands', visibility: 'dm',     secrets: {} },
      ],
    },
  });
  try {
    // DM sees both relationships.
    await loginAs(srv, DM);
    const dmData = await fetchData(srv);
    assert.equal(dmData.relationships.length, 2);
    // Player sees only the ally one.
    srv.clearCookies();
    const playerData = await fetchData(srv);
    assert.equal(playerData.relationships.length, 1);
    assert.equal(playerData.relationships[0].type, 'ally');
  } finally { await srv.kill(); }
});

test('DM-only entity with secret field: still hidden entirely (no double-strip leak)', async () => {
  // Defence-in-depth: a record marked visibility:'dm' AND secrets:{description:true}
  // should be dropped at the entity layer; we shouldn't see a stripped
  // husk in the player payload.
  const srv = await startServer({
    dmPassword: DM, playerPassword: PLAYER,
    seedData: {
      'characters.json': [{
        id: 'dm_with_secrets', name: 'Hidden', faction: 'neutral',
        description: 'Plot.', visibility: 'dm', secrets: { description: true },
      }],
    },
  });
  try {
    const data = await fetchData(srv);
    assert.equal(data.characters.length, 0, 'entire DM-only entity should be dropped');
  } finally { await srv.kill(); }
});

const { test } = require('node:test');
const assert    = require('node:assert/strict');
const fs        = require('fs');
const os        = require('os');
const path      = require('path');

const { isForbiddenKey, safeJoinIn, pickKeptSnapshots } = require('../server-utils.cjs');

// ── isForbiddenKey ────────────────────────────────────────────────
test('isForbiddenKey: rejects __proto__/constructor/prototype and non-strings', () => {
  for (const k of ['__proto__', 'constructor', 'prototype']) {
    assert.equal(isForbiddenKey(k), true, `should reject ${k}`);
  }
  assert.equal(isForbiddenKey(undefined), true);
  assert.equal(isForbiddenKey(null),      true);
  assert.equal(isForbiddenKey(42),        true);
  assert.equal(isForbiddenKey({}),        true);
});

test('isForbiddenKey: accepts ordinary string ids', () => {
  for (const k of ['frulam_a7b3c9', 'main', 'a-b', 'aPrototype', 'p__roto__']) {
    assert.equal(isForbiddenKey(k), false, `should accept ${k}`);
  }
});

// ── safeJoinIn ────────────────────────────────────────────────────
// Tests run against a real tempdir so the realpath/symlink branch is
// exercised, not just the string-prefix branch.
function withTmp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tiamat-test-'));
  try { return fn(dir); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('safeJoinIn: returns absolute path for plain children', () => {
  withTmp(dir => {
    const out = safeJoinIn(dir, 'foo.json');
    assert.equal(out, path.resolve(dir, 'foo.json'));
  });
});

test('safeJoinIn: rejects traversal segments', () => {
  withTmp(dir => {
    assert.equal(safeJoinIn(dir, '../escape'),       null);
    assert.equal(safeJoinIn(dir, 'sub/../../up'),    null);
    assert.equal(safeJoinIn(dir, '..\\winescape'),   null);
    assert.equal(safeJoinIn(dir, '..'),              null);
  });
});

test('safeJoinIn: rejects absolute paths', () => {
  withTmp(dir => {
    assert.equal(safeJoinIn(dir, '/etc/passwd'),  null);
    assert.equal(safeJoinIn(dir, '\\windows\\x'), null);
  });
});

test('safeJoinIn: rejects null bytes and non-string input', () => {
  withTmp(dir => {
    assert.equal(safeJoinIn(dir, 'foo\0bar'), null);
    assert.equal(safeJoinIn(dir, ''),         null);
    assert.equal(safeJoinIn(dir, null),       null);
    assert.equal(safeJoinIn(dir, 42),         null);
  });
});

test('safeJoinIn: allows nested paths whose ancestors exist', () => {
  withTmp(dir => {
    fs.mkdirSync(path.join(dir, 'a', 'b'), { recursive: true });
    const out = safeJoinIn(dir, 'a/b/leaf.txt');   // leaf may not exist
    assert.equal(out, path.resolve(dir, 'a', 'b', 'leaf.txt'));
  });
});

// Symlink test: skip on Windows where mklink needs admin privilege.
const canSymlink = process.platform !== 'win32';
test('safeJoinIn: rejects symlinks pointing outside the dir', { skip: !canSymlink }, () => {
  withTmp(dir => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'tiamat-out-'));
    try {
      fs.symlinkSync(outside, path.join(dir, 'escape'));
      assert.equal(safeJoinIn(dir, 'escape/anything'), null);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

// ── pickKeptSnapshots ─────────────────────────────────────────────
function meta(id, iso) { return { id, createdAt: iso }; }

test('pickKeptSnapshots: keeps everything when below recentKeep', () => {
  const metas = [
    meta('a', '2026-04-01T00:00:00.000Z'),
    meta('b', '2026-04-02T00:00:00.000Z'),
  ];
  const keep = pickKeptSnapshots(metas, { recentKeep: 50, dailyDays: 14, now: Date.parse('2026-04-03T00:00:00Z') });
  assert.deepEqual([...keep].sort(), ['a', 'b']);
});

test('pickKeptSnapshots: keeps the last N by recency', () => {
  const metas = [];
  for (let i = 1; i <= 5; i++) metas.push(meta(`s${i}`, `2026-04-0${i}T00:00:00.000Z`));
  const keep = pickKeptSnapshots(metas, { recentKeep: 3, dailyDays: 0, now: Date.parse('2026-04-06T00:00:00Z') });
  // Daily window is 0 days → only the recent window contributes.
  assert.deepEqual([...keep].sort(), ['s3', 's4', 's5']);
});

test('pickKeptSnapshots: daily window keeps latest snap per UTC-day', () => {
  // Three on day 1, one on day 2, one on day 3. recentKeep=1 keeps
  // only the very newest; daily should keep one per day for last 14d.
  const metas = [
    meta('d1-a', '2026-04-01T03:00:00.000Z'),
    meta('d1-b', '2026-04-01T15:00:00.000Z'),  // latest of day 1
    meta('d1-c', '2026-04-01T06:00:00.000Z'),
    meta('d2',   '2026-04-02T10:00:00.000Z'),
    meta('d3',   '2026-04-03T10:00:00.000Z'),
  ];
  const now  = Date.parse('2026-04-04T00:00:00Z');
  const keep = pickKeptSnapshots(metas, { recentKeep: 1, dailyDays: 14, now });
  // Recent: d3. Daily: d1-b (latest of day 1), d2, d3. Union: 3 ids.
  assert.deepEqual([...keep].sort(), ['d1-b', 'd2', 'd3']);
});

test('pickKeptSnapshots: prunes anything outside both windows', () => {
  const metas = [
    meta('ancient', '2025-01-01T00:00:00.000Z'),
    meta('recent',  '2026-04-03T00:00:00.000Z'),
  ];
  const now  = Date.parse('2026-04-04T00:00:00Z');
  const keep = pickKeptSnapshots(metas, { recentKeep: 1, dailyDays: 14, now });
  assert.equal(keep.has('ancient'), false);
  assert.equal(keep.has('recent'),  true);
});

test('pickKeptSnapshots: skips entries with unparseable timestamps in daily window', () => {
  const metas = [
    meta('bad',    'not-a-date'),
    meta('good',   '2026-04-03T00:00:00.000Z'),
  ];
  const now  = Date.parse('2026-04-04T00:00:00Z');
  const keep = pickKeptSnapshots(metas, { recentKeep: 5, dailyDays: 14, now });
  // recentKeep=5 sweeps both into the recent window; the daily branch
  // just shouldn't crash on the bad row.
  assert.equal(keep.has('good'), true);
});

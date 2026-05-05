// Server-side helpers, extracted from server.js so they can be unit
// tested. Importing server.js directly would call app.listen(), which
// is fine in production but flaky in tests (port collisions, dangling
// servers). Pure-ish functions only — no module-level side effects.

const fs   = require('fs');
const path = require('path');

// Keys that would write to Object.prototype on `container[k] = …`.
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** True if `k` is non-string or one of the prototype-pollution keys.
 *  Used by every keyed-object PATCH path to refuse hostile ids. */
function isForbiddenKey(k) {
  return typeof k !== 'string' || FORBIDDEN_KEYS.has(k);
}

/** Resolve `rel` inside `dir` and return the absolute path only if
 *  the result is genuinely contained — rejects:
 *    - non-string / empty input
 *    - absolute paths (leading `/` or `\`)
 *    - traversal segments (`..`)
 *    - null bytes
 *    - results that escape `dir` after path.resolve
 *    - symlink escapes (any existing prefix is `realpath`-checked)
 *
 *  Used at every boundary that accepts caller-supplied path
 *  fragments (zip entries, PATCH portrait URLs, etc.). Returns
 *  `null` to reject — callers MUST check for null before using. */
function safeJoinIn(dir, rel) {
  if (typeof rel !== 'string' || !rel) return null;
  if (rel.startsWith('/') || rel.startsWith('\\')) return null;
  if (/(^|[\\/])\.\.([\\/]|$)/.test(rel))         return null;
  if (rel.includes('\0'))                          return null;
  const resolved = path.resolve(dir, rel);
  const root     = path.resolve(dir);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  // Defeat symlink escapes: if any prefix of the resolved path is a
  // symlink that points outside `dir`, reject. We can only realpath
  // existing prefixes (the leaf may not exist yet for a write target).
  try {
    let probe = resolved;
    while (probe !== root && probe.length > root.length) {
      if (fs.existsSync(probe)) {
        const real = fs.realpathSync(probe);
        if (real !== root && !real.startsWith(root + path.sep)) return null;
        break;
      }
      const next = path.dirname(probe);
      if (next === probe) break;
      probe = next;
    }
  } catch (_) { return null; }
  return resolved;
}

/** Pure pruning policy. Given an array of snapshot metas
 *  `{ id, createdAt }` (timestamps as ISO strings), return a Set of
 *  ids the retention policy keeps:
 *    - the most recent `recentKeep`,
 *    - plus the latest snapshot per UTC-day for the last `dailyDays`
 *      days.
 *
 *  Anything not in the returned set is eligible for deletion. The
 *  full pruner in server.js just wraps this with the actual unlinks.
 *  `now` defaults to Date.now() — pass an explicit value in tests. */
function pickKeptSnapshots(metas, { recentKeep = 50, dailyDays = 14, now = Date.now() } = {}) {
  const sorted = metas.slice().sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const keep = new Set();
  // Recent window: last N regardless of date.
  sorted.slice(-recentKeep).forEach(m => keep.add(m.id));

  // Daily window: latest snapshot per UTC-day for the last `dailyDays` days.
  const oldestDayMs = now - dailyDays * 86_400_000;
  const byDay = new Map();
  for (const m of sorted) {
    const t = Date.parse(m.createdAt);
    if (Number.isNaN(t)) continue;
    if (t < oldestDayMs) continue;
    const day = m.createdAt.slice(0, 10);
    byDay.set(day, m.id);   // last write wins → latest of the day
  }
  for (const id of byDay.values()) keep.add(id);
  return keep;
}

module.exports = { isForbiddenKey, safeJoinIn, pickKeptSnapshots, FORBIDDEN_KEYS };

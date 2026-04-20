// ═══════════════════════════════════════════════════════════════
//  UTILS — shared helpers used across modules.
//  Replaces the per-module copies of _esc / _toast and adds
//  diacritic-insensitive normalization for search.
// ═══════════════════════════════════════════════════════════════

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function escapeRe(s) {
  return String(s ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Lowercase + strip diacritics. Used for search matching ("kresava" → "Křesava"). */
export function norm(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function debounce(fn, ms = 120) {
  let t;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}

/** Czech relative-time formatter. Input: timestamp ms (typically from
 *  `entity.updatedAt`). Output short, human strings for recent times,
 *  falling back to an absolute date for anything older than ~10 days.
 *
 *    just now (< 1 min)   → "teď"
 *    minutes  (< 60 min)  → "před N minutami"
 *    hours    (< 24 h)    → "před N hodinami"
 *    days     (< 10 d)    → "před N dny" / "včera"
 *    older                → "12. 3. 2026"                    */
export function humanTime(ms, now = Date.now()) {
  if (!ms || typeof ms !== 'number') return '';
  const diff = Math.max(0, now - ms);
  const sec  = Math.floor(diff / 1000);
  if (sec < 45) return 'teď';
  const min  = Math.floor(sec / 60);
  if (min < 60) return `před ${min} ${min === 1 ? 'minutou' : min < 5 ? 'minutami' : 'minutami'}`;
  const hr   = Math.floor(min / 60);
  if (hr < 24) return `před ${hr} ${hr === 1 ? 'hodinou' : hr < 5 ? 'hodinami' : 'hodinami'}`;
  const day  = Math.floor(hr / 24);
  if (day === 1) return 'včera';
  if (day < 10) return `před ${day} dny`;
  // Absolute date for anything older (Czech short form D. M. YYYY).
  const d = new Date(ms);
  return `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}`;
}

/** Diacritic-insensitive slug. Used to build stable heading IDs for
 *  the article outline (TOC) so anchor links survive small edits
 *  as long as the human-readable heading text is unchanged.        */
export function slugify(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80);
}

/** Scan raw markdown for ATX headings (# .. ###) and return an
 *  array of { level, text, slug } entries. Heading IDs in the
 *  rendered HTML match these slugs, so anchors link up cleanly. */
export function extractOutline(src) {
  const text = String(src ?? '');
  if (!text) return [];
  const out = [];
  for (const line of text.split('\n')) {
    const m = /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    out.push({
      level: m[1].length,
      text:  m[2].trim(),
      slug:  slugify(m[2].trim()),
    });
  }
  return out;
}

// ─ Wiki-link resolver (phase 4) ──────────────────────────────────
// `expandWikiLinks(src)` rewrites `[[Název]]` (and `[[Název|hint]]`)
// into real markdown links to the matching entity. The resolver is
// injected by app.js at init so utils.js stays free of Store imports.
let _wikiResolver = null;
export function setWikiLinkResolver(fn) { _wikiResolver = fn; }

export function expandWikiLinks(src) {
  const text = String(src ?? '');
  if (!text || !_wikiResolver) return text;
  return text.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, label, hint) => {
    const match = _wikiResolver(label.trim(), hint ? hint.trim() : '');
    if (!match) return `<span class="wlink-missing" title="Nenalezeno">[[${label}]]</span>`;
    return `[${label}](#/${match.kind}/${match.id})`;
  });
}

/**
 * Render Markdown to sanitized HTML for long-description fields.
 * Uses vendored marked + DOMPurify (loaded globally from index.html).
 * Falls back to escaped + <br>-joined text if libs aren't loaded yet.
 *
 * Post-processes the output to add `id` attributes onto h1..h6
 * elements (matching `slugify(heading)`), so the sidebar outline
 * links can jump to sections.
 *
 * Pipes the source through `expandWikiLinks` first so `[[Name]]`
 * syntax becomes a real link before marked parses it.
 */
export function renderMarkdown(src) {
  const raw = String(src ?? '');
  if (!raw.trim()) return '';
  // Expand [[Name]] / [[Name|kind:id]] into real markdown links first,
  // then let marked parse the rest. Anything that doesn't resolve
  // stays as a visibly-broken span the GM can fix.
  const text = expandWikiLinks(raw);
  const marked  = window.marked;
  const purify  = window.DOMPurify;
  if (!marked || !purify) {
    return esc(text).replace(/\n/g, '<br>');
  }
  const html = typeof marked.parse === 'function'
    ? marked.parse(text, { breaks: true, gfm: true })
    : marked(text, { breaks: true, gfm: true });
  const sanitized = purify.sanitize(html, {
    ADD_ATTR: ['target', 'rel', 'id'],
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed'],
  });
  if (typeof document === 'undefined') return sanitized;
  const tmp = document.createElement('div');
  tmp.innerHTML = sanitized;
  tmp.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(h => {
    if (!h.id) h.id = slugify(h.textContent || '');
  });
  return tmp.innerHTML;
}


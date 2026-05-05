import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  esc,
  escapeRe,
  norm,
  slugify,
  extractOutline,
  expandWikiLinks,
  setWikiLinkResolver,
  clearMarkdownCache,
} from '../web/js/utils.js';

describe('esc', () => {
  it('escapes the four HTML-significant characters', () => {
    assert.equal(esc('<a href="#">A&B</a>'), '&lt;a href=&quot;#&quot;&gt;A&amp;B&lt;/a&gt;');
  });
  it('coerces null/undefined to empty string', () => {
    assert.equal(esc(null), '');
    assert.equal(esc(undefined), '');
  });
});

describe('escapeRe', () => {
  it('escapes regex meta-characters', () => {
    assert.equal(escapeRe('a.b*c?'), 'a\\.b\\*c\\?');
  });
});

describe('norm', () => {
  it('lowercases and strips diacritics', () => {
    assert.equal(norm('Křesadlo'), 'kresadlo');
    assert.equal(norm('Šárka'), 'sarka');
    assert.equal(norm('café'), 'cafe');
  });
  it('idempotent on plain ASCII', () => {
    assert.equal(norm('hello world'), 'hello world');
  });
});

describe('slugify', () => {
  it('produces ASCII slug from Czech', () => {
    assert.equal(slugify('Křesadlo Hlubokomyslné'), 'kresadlo-hlubokomyslne');
  });
  it('caps at 80 chars', () => {
    const long = 'a'.repeat(100);
    assert.equal(slugify(long).length, 80);
  });
  it('strips punctuation', () => {
    assert.equal(slugify('Hello, World!'), 'hello-world');
  });
});

describe('extractOutline', () => {
  it('extracts ATX headings up to ###', () => {
    const md = '# A\n## B\n### C\n#### D\nplain';
    const out = extractOutline(md);
    assert.equal(out.length, 3);
    assert.deepEqual(out.map(o => o.level), [1, 2, 3]);
    assert.deepEqual(out.map(o => o.text), ['A', 'B', 'C']);
  });

  it('disambiguates duplicate headings with -2, -3 suffixes', () => {
    const md = '# Foo\n## Foo\n## Foo';
    const out = extractOutline(md);
    assert.deepEqual(out.map(o => o.slug), ['foo', 'foo-2', 'foo-3']);
  });

  it('handles trailing # in setext-like headings', () => {
    const md = '## Section ##';
    const out = extractOutline(md);
    assert.equal(out[0].slug, 'section');
  });

  it('returns empty array for empty input', () => {
    assert.deepEqual(extractOutline(''), []);
    assert.deepEqual(extractOutline(null), []);
  });
});

describe('expandWikiLinks + resolver', () => {
  it('passes through text when no resolver is set', () => {
    setWikiLinkResolver(null);
    assert.equal(expandWikiLinks('see [[Frulam]]'), 'see [[Frulam]]');
  });

  it('rewrites resolved links into markdown links', () => {
    setWikiLinkResolver((label, hint) => ({ kind: 'postava', id: 'frulam_a7b3c9' }));
    assert.equal(
      expandWikiLinks('see [[Frulam]]'),
      'see [Frulam](#/postava/frulam_a7b3c9)'
    );
  });

  it('renders unresolved links with a missing-link span', () => {
    setWikiLinkResolver(() => null);
    const out = expandWikiLinks('see [[Mystery NPC]]');
    assert.match(out, /class="wlink-missing"/);
    assert.match(out, /\[\[Mystery NPC\]\]/);
  });

  it('handles disambiguation hint syntax', () => {
    setWikiLinkResolver((label, hint) => {
      if (hint === 'postava:foo') return { kind: 'postava', id: 'foo' };
      return null;
    });
    assert.equal(
      expandWikiLinks('[[Foo|postava:foo]]'),
      '[Foo](#/postava/foo)'
    );
  });
});

describe('clearMarkdownCache', () => {
  it('exists and is callable', () => {
    assert.equal(typeof clearMarkdownCache, 'function');
    clearMarkdownCache();   // does not throw
  });
});

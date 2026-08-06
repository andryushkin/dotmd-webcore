/**
 * Article extraction corpus.
 *
 * What this proves: given hand-written DOM shapes, `findArticle` picks a root
 * whose visible text includes the strings listed as must-have, and does not
 * include the strings listed as must-not — and reports a hit rate over the set.
 *
 * What it cannot prove: visible-text scoring against a real cascade. Under
 * linkedom and happy-dom a node with `display: none` still contributes text, so
 * the harness always passes `isVisible: () => true` (the default). The production
 * path injects a predicate from `getComputedStyle`, the same seam
 * `computedStyleIn(view)` already uses for the snapshot.
 */
import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import { findArticle, DEFAULT_MIN_TEXT_LENGTH } from '../src/extract.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'extract-fixtures');

function load(name: string, url = 'https://example.com/page'): Document {
  const html = readFileSync(join(FIXTURES, name), 'utf8');
  const window = new Window({ url });
  window.document.write(html);
  return window.document as unknown as Document;
}

function textOf(nodes: Element[]): string {
  return nodes.map((n) => n.textContent ?? '').join('\n');
}

interface Case {
  file: string;
  must: string[];
  mustNot: string[];
  /** Extra assertions beyond the string lists. */
  check?: (doc: Document, result: ReturnType<typeof findArticle>) => void;
}

const CORPUS: Case[] = [
  {
    file: 'feed-many-articles.html',
    must: [
      'Featured investigation into municipal water',
      'laboratory samples collected over eighteen months',
    ],
    mustNot: ['Tiny teaser one', 'Unrelated promo blurb'],
    check: (_doc, result) => {
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // Prefer the featured article, not the feed shell.
      expect(result.nodes.some((n) => n.id === 'feature' || n.closest('#feature'))).toBe(true);
    },
  },
  {
    file: 'heading-above-article.html',
    must: [
      'How sectioning splits a title from its body',
      'paragraphs live inside the article element',
    ],
    mustNot: ['SiteName Media Group', 'Sign in'],
    check: (_doc, result) => {
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.nodes.length).toBe(2);
      expect(result.nodes[0]!.tagName.toLowerCase()).toBe('h1');
      expect(result.nodes[1]!.tagName.toLowerCase()).toBe('article');
    },
  },
  {
    file: 'wide-main-furniture.html',
    must: [
      'An essay wrapped only in main',
      'newsletter box and the read-next strip',
    ],
    mustNot: [],
    check: (_doc, result) => {
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const joined = result.exclude.join(' ');
      // Furniture selectors must name the chrome, not the prose column.
      expect(
        result.exclude.some((s) => /newsletter|read-next|related|nav|aside/i.test(s)),
      ).toBe(true);
      expect(joined).not.toMatch(/content/);
    },
  },
  {
    file: 'docs-toc-survives.html',
    must: [
      'Introduction',
      'table of contents is a nav of same-document fragment links',
      'On this page',
    ],
    mustNot: [],
    check: (_doc, result) => {
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // TOC must not appear in the exclude list.
      for (const sel of result.exclude) {
        expect(sel.includes('toc') || sel.includes('table-of-contents')).toBe(false);
      }
      const text = textOf(result.nodes);
      expect(text).toContain('On this page');
      // Related promo may be excluded when it sits inside the chosen root.
      // If the root is the article alone, the aside is simply outside.
    },
  },
  {
    file: 'paywall-teaser-first.html',
    must: [
      'The investigation the paywall is hiding',
      'schema.org article body',
    ],
    mustNot: ['Subscribe to keep reading'],
    check: (_doc, result) => {
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.nodes.some((n) => n.getAttribute('itemprop') === 'articleBody')).toBe(true);
    },
  },
  {
    file: 'iframe-thin.html',
    must: [],
    mustNot: [],
    check: (_doc, result) => {
      // Shell with an embed and almost no prose: refuse rather than succeed on chrome.
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason === 'too-thin' || result.reason === 'iframe-or-canvas' || result.reason === 'no-candidates').toBe(true);
    },
  },
];

describe('findArticle corpus', () => {
  test('hit rate over the hand-written fixtures', () => {
    let hits = 0;
    const failures: string[] = [];

    for (const c of CORPUS) {
      const doc = load(c.file);
      const result = findArticle(doc);
      let ok = true;
      const reasons: string[] = [];

      if (c.must.length > 0) {
        if (!result.ok) {
          ok = false;
          reasons.push(`refused (${result.reason})`);
        } else {
          const text = textOf(result.nodes);
          for (const needle of c.must) {
            if (!text.includes(needle)) {
              ok = false;
              reasons.push(`missing: ${needle}`);
            }
          }
          for (const needle of c.mustNot) {
            if (text.includes(needle)) {
              ok = false;
              reasons.push(`unwanted: ${needle}`);
            }
          }
        }
      }

      if (c.check) {
        try {
          c.check(doc, result);
        } catch (e) {
          ok = false;
          reasons.push(`check: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      if (ok) hits += 1;
      else failures.push(`${c.file}: ${reasons.join('; ')}`);
    }

    const hitRate = hits / CORPUS.length;
    console.log(
      `extract corpus hit rate: ${hits}/${CORPUS.length} = ${(hitRate * 100).toFixed(1)}%`,
    );
    if (failures.length > 0) {
      console.log(failures.join('\n'));
    }
    expect(hitRate).toBe(1);
    expect(hits).toBe(CORPUS.length);
  });

  test('metrics are filled on a soft refusal so the product can set policy', () => {
    const doc = load('paywall-teaser-first.html');
    const result = findArticle(doc, { minTextLength: 50_000 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('too-thin');
    expect(result.metrics.textLength).toBeGreaterThan(0);
    expect(result.metrics.bodyTextLength).toBeGreaterThan(result.metrics.textLength - 1);
  });

  test('DEFAULT_MIN_TEXT_LENGTH is the documented soft floor', () => {
    expect(DEFAULT_MIN_TEXT_LENGTH).toBe(200);
  });

  test('isVisible can drop a candidate the cascade would hide', () => {
    const doc = load('paywall-teaser-first.html');
    const hidden = new Set<Element>();
    const article = doc.querySelector('[itemprop="articleBody"]');
    expect(article).toBeTruthy();
    // Hide the real article; only the teaser remains.
    if (article) {
      for (const el of [article, ...article.querySelectorAll('*')]) hidden.add(el);
    }
    const result = findArticle(doc, {
      isVisible: (el) => !hidden.has(el),
      minTextLength: 50,
    });
    // With the body hidden, nothing long enough remains — refuse or pick a thin teaser.
    if (result.ok) {
      expect(textOf(result.nodes)).not.toContain('schema.org article body');
    } else {
      expect(result.metrics.textLength).toBeLessThan(DEFAULT_MIN_TEXT_LENGTH);
    }
  });
});

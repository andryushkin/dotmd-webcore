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
import { highlightsToMd } from '../src/capture.js';

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
    // Title outside, section h2s inside — the ordinary article. Lift must still
    // take the outer h1; refusing on any inside heading is the defect that left
    // the document opening on a section under topHeadingLevel: 1.
    file: 'heading-above-with-sections.html',
    must: [
      'How the reader picks an article',
      'Why it matters',
      'By A. Author',
    ],
    mustNot: ['SiteName Media Group', 'Sign in'],
    check: (_doc, result) => {
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.nodes.length).toBe(2);
      expect(result.nodes[0]!.tagName.toLowerCase()).toBe('h1');
      expect(result.nodes[0]!.textContent).toContain('How the reader picks an article');
      expect(result.nodes[1]!.tagName.toLowerCase()).toBe('article');
      // Lifted h1 counts for the consumer that asks whether it got a whole document.
      expect(result.metrics.hasH1).toBe(true);
    },
  },
  {
    // Outer h1 is a category; the article already has the real title as h1.
    // Equal rank → do not lift.
    file: 'heading-above-with-own-h1.html',
    must: [
      'The real title of this investigation',
      'Laboratory samples collected over eighteen months',
    ],
    mustNot: ['Site or category', 'SiteName Media Group'],
    check: (_doc, result) => {
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.nodes.length).toBe(1);
      expect(result.nodes[0]!.tagName.toLowerCase()).toBe('article');
      expect(result.metrics.hasH1).toBe(true);
      expect(textOf(result.nodes)).not.toContain('Site or category');
    },
  },
  {
    // Title + deck above article with its own section h2. Nearest preceding is
    // the deck; choosing by distance alone refused the lift and dropped the h1.
    file: 'heading-above-with-deck.html',
    must: [
      'The real title of the investigation',
      'A deck that explains the title in one sentence',
      'A section inside the body',
    ],
    mustNot: ['SiteName Media Group', 'Sign in'],
    check: (_doc, result) => {
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.nodes.length).toBe(3);
      expect(result.nodes[0]!.tagName.toLowerCase()).toBe('h1');
      expect(result.nodes[0]!.textContent).toContain('The real title of the investigation');
      expect(result.nodes[1]!.tagName.toLowerCase()).toBe('h2');
      expect(result.nodes[1]!.textContent).toContain('A deck that explains the title');
      expect(result.nodes[2]!.tagName.toLowerCase()).toBe('article');
      // Lifted h1 must count even though the scored root was the article alone.
      expect(result.metrics.hasH1).toBe(true);
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
  {
    // Ordinary blog: no <main>, site name in body-level <header>. Must not lift.
    file: 'blog-site-header.html',
    must: [
      'laboratory samples collected over eighteen months',
      'ordinary blog has no main element',
    ],
    mustNot: ['My Cool Website'],
    check: (_doc, result) => {
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.nodes.length).toBe(1);
      expect(result.nodes[0]!.tagName.toLowerCase()).toBe('article');
      expect(textOf(result.nodes)).not.toContain('My Cool Website');
    },
  },
  {
    // Short post: one newsletter <p> is 1/3 of paragraph count — text share must still exclude it.
    file: 'short-article-newsletter.html',
    must: ['Real article title', 'first paragraph of a short post'],
    mustNot: [],
    check: (_doc, result) => {
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(
        result.exclude.some((s) => /newsletter|aside/i.test(s)),
      ).toBe(true);
    },
  },
  {
    // No <main>, no <article>, no schema — only div#primary with paragraphs.
    // The block-fallback path must accept it; preferSpecific must take primary
    // over wrapper; the site name in #smallhead must not be lifted.
    file: 'no-semantic-div-blog.html',
    must: [
      'A post with no semantic tags around it',
      'laboratory samples collected over eighteen months',
    ],
    mustNot: ['My Cool Website', 'calendar chrome that is not the article'],
    check: (_doc, result) => {
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.nodes.some((n) => n.id === 'primary')).toBe(true);
      expect(result.nodes.some((n) => n.id === 'wrapper')).toBe(false);
      expect(textOf(result.nodes)).not.toContain('My Cool Website');
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

/**
 * The reading mode passes `mode: "selection"`, under which the converter keeps
 * `<aside>` that the default profile would drop. Asserting only on the exclude
 * *list* hid a threshold that left "Subscribe…" in the file. The product path
 * is findArticle → highlightsToMd with that profile; the assertion is the Markdown.
 */
describe('findArticle → highlightsToMd (selection profile)', () => {
  const selectionConversion = {
    mode: 'selection' as const,
    topHeadingLevel: 1,
  };

  test('newsletter furniture is gone from the Markdown on a short article', () => {
    const doc = load('short-article-newsletter.html');
    const found = findArticle(doc);
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.exclude.length).toBeGreaterThan(0);

    const { md } = highlightsToMd(found.nodes, doc, {
      exclude: found.exclude,
      conversion: selectionConversion,
    });
    expect(md).toContain('Real article title');
    expect(md).toContain('first paragraph of a short post');
    expect(md).not.toContain('Subscribe to our promo newsletter now');
  });

  test('site banner is not the document title in the Markdown', () => {
    const doc = load('blog-site-header.html');
    const found = findArticle(doc);
    expect(found.ok).toBe(true);
    if (!found.ok) return;

    const { md } = highlightsToMd(found.nodes, doc, {
      exclude: found.exclude,
      conversion: selectionConversion,
    });
    expect(md).toContain('laboratory samples collected over eighteen months');
    expect(md).not.toContain('My Cool Website');
    // No leading site-name heading.
    expect(md.trimStart().startsWith('# My Cool Website')).toBe(false);
  });

  test('main > h1 above article still reaches the Markdown as the title', () => {
    const doc = load('heading-above-article.html');
    const found = findArticle(doc);
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.nodes.length).toBe(2);

    const { md } = highlightsToMd(found.nodes, doc, {
      exclude: found.exclude,
      conversion: selectionConversion,
    });
    expect(md).toContain('How sectioning splits a title from its body');
    expect(md).toContain('paragraphs live inside the article element');
    expect(md).not.toContain('SiteName Media Group');
  });

  test('section h2s inside the article do not drop the outer title', () => {
    const doc = load('heading-above-with-sections.html');
    const found = findArticle(doc);
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.nodes.length).toBe(2);
    expect(found.metrics.hasH1).toBe(true);

    const { md } = highlightsToMd(found.nodes, doc, {
      exclude: found.exclude,
      conversion: selectionConversion,
    });
    // Under topHeadingLevel: 1 the outer h1 is the document title; the section
    // becomes ##. Without the lift, "Why it matters" would be raised to #.
    expect(md).toMatch(/^#\s+How the reader picks an article/m);
    expect(md).toContain('Why it matters');
    expect(md.trimStart().startsWith('# Why it matters')).toBe(false);
    expect(md).not.toContain('SiteName Media Group');
  });

  test('outer category h1 is not lifted when the article has its own h1', () => {
    const doc = load('heading-above-with-own-h1.html');
    const found = findArticle(doc);
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.nodes.length).toBe(1);

    const { md } = highlightsToMd(found.nodes, doc, {
      exclude: found.exclude,
      conversion: selectionConversion,
    });
    expect(md).toContain('The real title of this investigation');
    expect(md).not.toContain('Site or category');
  });

  test('title + deck above article: both reach Markdown, title stays #', () => {
    const doc = load('heading-above-with-deck.html');
    const found = findArticle(doc);
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.nodes.length).toBe(3);
    expect(found.metrics.hasH1).toBe(true);

    const { md } = highlightsToMd(found.nodes, doc, {
      exclude: found.exclude,
      conversion: selectionConversion,
    });
    // Without the multi-candidate lift, nodes were [article] and the document
    // opened on body prose; with only the nearest heading, the deck blocked the h1.
    expect(md).toMatch(/^#\s+The real title of the investigation/m);
    expect(md).toContain('A deck that explains the title in one sentence');
    expect(md).toContain('A section inside the body');
    expect(md.trimStart().startsWith('# A deck')).toBe(false);
    expect(md).not.toContain('SiteName Media Group');
  });

  test('no-semantic div blog: primary column reaches Markdown without the site name', () => {
    const doc = load('no-semantic-div-blog.html');
    const found = findArticle(doc);
    expect(found.ok).toBe(true);
    if (!found.ok) return;

    const { md } = highlightsToMd(found.nodes, doc, {
      exclude: found.exclude,
      conversion: selectionConversion,
    });
    expect(md).toContain('A post with no semantic tags around it');
    expect(md).toContain('laboratory samples collected over eighteen months');
    expect(md).not.toContain('My Cool Website');
    expect(md.trimStart().startsWith('# My Cool Website')).toBe(false);
  });
});

/**
 * Frozen copies of live pages (downloaded once). A live site drifts — these
 * files are the evidence for the two defects, not a contract with the network.
 * Assert on substrings and the opening lines, never full snapshots: the HTML is
 * hundreds of kilobytes.
 */
describe('findArticle on frozen real pages', () => {
  const REAL = join(dirname(fileURLToPath(import.meta.url)), 'real-pages');
  const selectionConversion = {
    mode: 'selection' as const,
    topHeadingLevel: 1,
  };

  function loadReal(name: string, url: string): Document {
    const html = readFileSync(join(REAL, name), 'utf8');
    const window = new Window({ url });
    window.document.write(html);
    return window.document as unknown as Document;
  }

  function capture(doc: Document): { found: ReturnType<typeof findArticle>; md: string } {
    const found = findArticle(doc);
    if (!found.ok) return { found, md: '' };
    const { md } = highlightsToMd(found.nodes, doc, {
      exclude: found.exclude,
      conversion: selectionConversion,
    });
    return { found, md };
  }

  test('simonwillison.net day archive: no semantic tags, still a document', () => {
    // Before: refuse no-candidates. The page is div#wrapper / #primary only.
    const doc = loadReal(
      'simonwillison.net_2026_Jan_1_.html',
      'https://simonwillison.net/2026/Jan/1/',
    );
    const { found, md } = capture(doc);
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.nodes.some((n) => n.id === 'primary')).toBe(true);
    // Opens on the day heading, not the site name in #smallhead.
    expect(md.trimStart().startsWith('#')).toBe(true);
    expect(md).toMatch(/^#\s+Thursday, 1st January 2026/m);
    expect(md).toContain('gisthost');
    expect(md).not.toContain("Simon Willison’s Weblog");
    expect(md).not.toContain('Simon Willison\'s Weblog');
  });

  test('MDN CSS cascade: title first, in-page TOC kept, no chrome regression', () => {
    const doc = loadReal(
      'developer.mozilla.org_en-US_docs_Web_CSS.html',
      'https://developer.mozilla.org/en-US/docs/Web/CSS',
    );
    const { found, md } = capture(doc);
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(md.trimStart().startsWith('# Introduction to the CSS cascade')).toBe(true);
    expect(md).toContain('In this article');
    expect(md).toContain('Cascading order');
    // Must not pick up site chrome that lives outside main.
    expect(md).not.toContain('Toggle the table of contents');
  });

  test('Wikipedia Diffusion: title first, no TOC toggle or language switcher', () => {
    // Before: opened on "Toggle the table of contents" / "81 languages" because
    // isTableOfContents trusted a class name and the language strip had no
    // furniture tag. The document TOC exemption must keep MDN working (above)
    // while these site-chrome controls are excluded.
    const doc = loadReal(
      'en.wikipedia.org_wiki_Diffusion.html',
      'https://en.wikipedia.org/wiki/Diffusion',
    );
    const { found, md } = capture(doc);
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    const head = md.trimStart().slice(0, 400);
    expect(md.trimStart().startsWith('# Diffusion')).toBe(true);
    expect(head).not.toContain('Toggle the table of contents');
    expect(head).not.toContain('81 languages');
    expect(head).not.toContain('Tools');
    expect(md).not.toContain('Toggle the table of contents');
    // Language names from the switcher must not lead the file.
    expect(md.trimStart().startsWith('81 languages')).toBe(false);
    // Article prose still present.
    expect(md).toMatch(/diffusi/i);
  });
});

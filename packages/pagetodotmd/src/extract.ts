/**
 * Which part of a live page is the article — free functions a consumer calls
 * before capture, never a side effect of capture itself.
 *
 * A reading mode has to decide this before anything is converted, and the
 * clipper wants the same decision for "capture the whole article". Both need a
 * live document and the same visibility question the snapshot already asks;
 * neither should reimplement the scorer. The capture paths stay untouched:
 * these functions hand back elements and selectors the existing options already
 * know how to spend (`highlightsToMd` on a list of nodes, `CaptureOptions.exclude`
 * on furniture inside a wide root).
 *
 * The result is a *list* of nodes, not a single root. Ordinary markup puts the
 * title outside the body — `<main><h1>…</h1><article>…</article></main>` — and
 * the scorer honestly picks `<article>` where the paragraphs live. A capture
 * that only took the root would ship a document with no title and a length that
 * still passed every threshold. `highlightsToMd` already walks a list with
 * `selectNodeContents` on each element, so `[h1, article]` arrives intact.
 */

/** Numbers the scorer settled on, for a consumer that wants its own threshold. */
export interface ArticleMetrics {
  /** Visible characters under the chosen root (or zero when nothing was chosen). */
  textLength: number;
  /** Paragraph elements under the root. */
  paragraphCount: number;
  /** Whether the root, or a heading lifted beside it, supplies an `h1`. */
  hasH1: boolean;
  /** Score the winner carried; zero when nothing was chosen. */
  score: number;
  /** Visible characters under `body` — context for the ratio, never a veto. */
  bodyTextLength: number;
}

export interface ArticleFound {
  ok: true;
  /**
   * Elements to capture, in document order. Usually one root; sometimes a
   * preceding title (and its standfirst deck) and then the root — see heading
   * lift below.
   */
  nodes: Element[];
  /**
   * Selectors for `CaptureOptions.exclude` — furniture inside a wide root that
   * the capture would otherwise keep. Built here because the thing that picked
   * the root is what knows what is beside the body rather than part of it.
   */
  exclude: string[];
  metrics: ArticleMetrics;
}

export type ArticleRefusal =
  | 'no-candidates'
  | 'too-thin'
  | 'iframe-or-canvas';

export interface ArticleRefused {
  ok: false;
  reason: ArticleRefusal;
  metrics: ArticleMetrics;
}

export type ArticleResult = ArticleFound | ArticleRefused;

/**
 * Options for `findArticle`. Everything here is the consumer's policy, except
 * the visibility predicate — that is the environment, the same shape
 * `computedStyleIn(view)` already takes for the snapshot.
 */
export interface FindArticleOptions {
  /**
   * Whether an element is visible enough that its text should count.
   *
   * Defaults to "everything is visible". Under linkedom and happy-dom a node
   * with `display: none` still contributes text, so a default that tried to
   * read the cascade here would claim a certainty the harness cannot give. A
   * real browser injects the answer — typically from `getComputedStyle` — the
   * same way the snapshot already does.
   */
  isVisible?: (el: Element) => boolean;
  /**
   * Soft floor on visible text length. Below it the result is `too-thin` with
   * the metrics filled in, so a product can show "nothing readable" instead of
   * an empty overlay. Defaults to {@link DEFAULT_MIN_TEXT_LENGTH}; pass `0` to
   * never refuse on length alone.
   */
  minTextLength?: number;
}

/**
 * Default soft floor. Not a product policy — a number that keeps a page of
 * chrome and three words out of a reading mode until the consumer overrides it.
 */
export const DEFAULT_MIN_TEXT_LENGTH = 200;

/** Class tokens that mark a teaser or furniture rather than a body. */
const FURNITURE_CLASS =
  /\b(card|teaser|related|promo|sidebar|newsletter|read-?next|recommended|advert|ad-slot|comments?)\b/i;

/** Tags that are sectioning content or a sectioning root we treat as a parent. */
const SECTIONING = new Set([
  'article', 'aside', 'nav', 'section', 'main', 'body', 'blockquote',
  'details', 'dialog', 'fieldset', 'figure', 'td',
]);

/** Tags whose own text is never article prose. */
const SKIP_TEXT_TAGS = new Set([
  'script', 'style', 'noscript', 'svg', 'math', 'template',
]);

interface Scored {
  el: Element;
  score: number;
  textLength: number;
  paragraphCount: number;
  hasH1: boolean;
}

/**
 * Find the article root on a live document, or refuse with the numbers that
 * made the decision.
 *
 * Candidates are scored, never first-match: a feed wraps a dozen `<article>`s in
 * `<main>`, and the first `[role="main"]` on many pages is a teaser card. Length
 * of *visible* text is the primary signal; an `h1`, paragraph density, and a
 * class penalty for `card|teaser|related|promo` move the ranking; a ratio to
 * `body` may add to the score and never subtracts — an article can legitimately
 * be a tenth of the page when the rest is comments and an infinite feed.
 *
 * When the page has no semantic candidates at all — older blogs, hand-written
 * sites, anything that never adopted `<main>` / `<article>` — the same scorer
 * runs over block containers that already hold paragraphs. Widening only then
 * (not when a thin semantic candidate exists) is deliberate: a teaser
 * `[role="main"]` must still lose to a real `articleBody`, and a thin `<main>`
 * must still refuse rather than fall through to `<div id="app">`. Taking `body`
 * and trimming it is not a candidate path either — that is the SPA / docs
 * failure the semantic-only list was narrowed to avoid.
 */
export function findArticle(
  doc: Document,
  options: FindArticleOptions = {},
): ArticleResult {
  const isVisible = options.isVisible ?? (() => true);
  const minTextLength = options.minTextLength ?? DEFAULT_MIN_TEXT_LENGTH;
  const body = doc.body;
  const empty: ArticleMetrics = {
    textLength: 0,
    paragraphCount: 0,
    hasH1: false,
    score: 0,
    bodyTextLength: 0,
  };
  if (!body) {
    return { ok: false, reason: 'no-candidates', metrics: empty };
  }

  const bodyTextLength = visibleTextLength(body, isVisible);
  const candidates = collectCandidates(doc, body);
  if (candidates.length === 0) {
    return {
      ok: false,
      reason: 'no-candidates',
      metrics: { ...empty, bodyTextLength },
    };
  }

  const scored = candidates
    .map((el) => scoreCandidate(el, bodyTextLength, isVisible))
    .sort((a, b) => b.score - a.score || b.textLength - a.textLength);

  // A wide <main> often outscores the <article> it wraps only because it also
  // holds the title or a strip of chrome. Prefer the more specific descendant
  // when it already carries most of the text — heading lift recovers a title
  // that sat outside, and a feed shell yields its longest leaf instead of
  // twelve teasers glued together. The same rule is what stops a block-fallback
  // winner from being the page shell (`#wrapper`) when `#primary` already holds
  // most of its prose.
  const winner = preferSpecific(scored);
  const metrics: ArticleMetrics = {
    textLength: winner.textLength,
    paragraphCount: winner.paragraphCount,
    hasH1: winner.hasH1,
    score: winner.score,
    bodyTextLength,
  };

  // An iframe or canvas standing in for the article has almost no prose of its
  // own. Handing it back is a wrong document, not a short one — refuse rather
  // than claim success on the menus around it.
  const tag = winner.el.tagName.toLowerCase();
  if (
    (tag === 'iframe' || tag === 'canvas') &&
    winner.textLength < Math.max(minTextLength, DEFAULT_MIN_TEXT_LENGTH)
  ) {
    return { ok: false, reason: 'iframe-or-canvas', metrics };
  }

  if (winner.textLength < minTextLength) {
    return { ok: false, reason: 'too-thin', metrics };
  }

  const lifted = liftHeadings(winner.el, isVisible);
  const nodes = lifted.length > 0 ? [...lifted, winner.el] : [winner.el];
  // A lifted h1 is the document title even though it sat outside the scored
  // root — hasH1 must say so, or a consumer that asks "whole document?" from
  // the metrics alone treats a titled capture as a fragment.
  if (lifted.some((h) => h.tagName.toLowerCase() === 'h1')) {
    metrics.hasH1 = true;
  }

  return {
    ok: true,
    nodes,
    exclude: furnitureSelectors(winner.el, isVisible),
    metrics,
  };
}

/** Cap on block-fallback candidates so a div-soup page is not scored node-by-node. */
const MAX_BLOCK_CANDIDATES = 48;

function collectCandidates(doc: Document, body: Element): Element[] {
  const seen = new Set<Element>();
  const out: Element[] = [];
  const add = (el: Element | null): void => {
    if (!el || seen.has(el) || el === body) return;
    // Never a whole document shell.
    if (el === doc.documentElement) return;
    seen.add(el);
    out.push(el);
  };

  for (const el of body.querySelectorAll('main, article, [role="main"]')) {
    add(el);
  }
  for (const el of body.querySelectorAll('[itemprop="articleBody"]')) {
    add(el);
  }
  // schema.org Article / NewsArticle / BlogPosting — the typed node itself is a
  // candidate when no articleBody was marked separately.
  for (const el of body.querySelectorAll(
    '[itemtype*="schema.org/Article"], [itemtype*="schema.org/NewsArticle"], [itemtype*="schema.org/BlogPosting"]',
  )) {
    add(el);
  }

  if (out.length > 0) return out;

  // No landmark, no schema: older blogs and hand-written pages. The scorer
  // already ranks by prose; give it block containers that hold paragraphs.
  // Only in this branch — see findArticle's note on why a thin semantic
  // candidate does not open the net.
  return collectBlockCandidates(body);
}

/**
 * Block containers that already look like prose columns. Used only when the
 * page exposes no semantic article root.
 *
 * Every `div` is too many on a large DOM; every element with text would pick
 * link strips. Requiring at least one non-empty `<p>` is the cheap filter that
 * matches what the density bonus already rewards, and a hard cap keeps the
 * walk bounded. Furniture and the page banner stay out so a sidebar calendar
 * or site header cannot win by accident.
 */
function collectBlockCandidates(body: Element): Element[] {
  const raw: Element[] = [];
  for (const el of body.querySelectorAll('div, section')) {
    if (el === body) continue;
    if (isFurnitureSignal(el)) continue;
    if (isPageBanner(el)) continue;
    if (!hasNonEmptyParagraph(el)) continue;
    raw.push(el);
  }

  if (raw.length <= MAX_BLOCK_CANDIDATES) return raw;

  // Too many: keep the paragraph-richest, then longest. Full scoring runs only
  // on this shortlist.
  raw.sort((a, b) => {
    const dp = countParagraphs(b, () => true) - countParagraphs(a, () => true);
    if (dp !== 0) return dp;
    return visibleTextLength(b) - visibleTextLength(a);
  });
  return raw.slice(0, MAX_BLOCK_CANDIDATES);
}

function hasNonEmptyParagraph(root: Element): boolean {
  for (const p of root.getElementsByTagName('p')) {
    if ((p.textContent ?? '').trim().length > 0) return true;
  }
  return false;
}

function scoreCandidate(
  el: Element,
  bodyTextLength: number,
  isVisible: (el: Element) => boolean,
): Scored {
  const textLength = visibleTextLength(el, isVisible);
  const paragraphCount = countParagraphs(el, isVisible);
  const hasH1 = hasHeadingLevel(el, 'h1', isVisible);
  const className = el.getAttribute('class') ?? '';
  const furniturePenalty = FURNITURE_CLASS.test(className) ? 800 : 0;

  // Paragraph density: reward real prose over a long nav of links. Cap so a
  // novel of one-sentence paragraphs does not run away with the score.
  const densityBonus = Math.min(paragraphCount, 40) * 40;
  const h1Bonus = hasH1 ? 400 : hasHeadingLevel(el, 'h2', isVisible) ? 120 : 0;

  // Against body: a large share of the page is a good sign and may only add.
  // A small share is normal (comments, feed) and must not veto.
  let bodyBonus = 0;
  if (bodyTextLength > 0 && textLength > 0) {
    const share = textLength / bodyTextLength;
    if (share >= 0.5) bodyBonus = 300;
    else if (share >= 0.2) bodyBonus = 120;
  }

  // A feed container holds several nested articles; prefer one of them.
  // First-match on <main> is exactly the defect this penalty is for.
  const feedPenalty = feedContainerPenalty(el);

  // Semantic preference: articleBody and article beat a bare main of equal text.
  const tag = el.tagName.toLowerCase();
  const role = (el.getAttribute('role') ?? '').toLowerCase();
  const itemprop = (el.getAttribute('itemprop') ?? '').toLowerCase();
  let semanticBonus = 0;
  if (itemprop === 'articlebody') semanticBonus = 200;
  else if (tag === 'article') semanticBonus = 150;
  else if (tag === 'main' || role === 'main') semanticBonus = 50;

  const score =
    textLength +
    densityBonus +
    h1Bonus +
    bodyBonus +
    semanticBonus -
    furniturePenalty -
    feedPenalty;

  return { el, score, textLength, paragraphCount, hasH1 };
}

/**
 * When a candidate contains several nested `<article>` elements, it is a feed
 * shell. Count every nested article — teasers are short and would never clear a
 * length floor, which is exactly when first-match on <main> used to win.
 */
function feedContainerPenalty(el: Element): number {
  const nested = el.querySelectorAll('article').length;
  // el itself may be an article wrapping others; those still count as nested.
  if (nested < 2) return 0;
  // Heavy enough that even a long main loses to one solid article inside it.
  return 2000 + nested * 200;
}

/**
 * If the current winner only leads because it wraps a stronger leaf, take the
 * leaf. Among several solid descendants (a feed), the highest-scoring one wins.
 */
function preferSpecific(scored: Scored[]): Scored {
  const top = scored[0]!;
  const solid = scored.filter(
    (c) =>
      c !== top &&
      top.el.contains(c.el) &&
      c.textLength >= top.textLength * 0.55,
  );
  if (solid.length === 0) return top;
  solid.sort((a, b) => b.score - a.score || b.textLength - a.textLength);
  return solid[0]!;
}

/**
 * Preceding h1–h2 nodes to capture ahead of the article root.
 *
 * Only heading elements, never a whole chrome region. Same sectioning parent,
 * no other `<article>` between them, never out of the page banner — that is the
 * ordinary blog `<body><header><h1>Site</h1></header><article>` shape, which
 * has no `<main>` and would otherwise open the document on the site name.
 *
 * Level, not distance: "what is this document called" is answered by rank
 * (h1 beats h2), not by which heading sits nearest the body. The standard
 * news shape is `<main><h1>Title</h1><h2>Deck</h2><article>…<h2>Section`, and
 * stopping at the first preceding heading left the walk on the deck; the level
 * rule then refused it (equal to the section h2 inside) and never considered
 * the h1 two steps away — so the capture opened on body prose with no title at
 * all. Collect every qualifying preceding heading, keep those that strictly
 * outrank the root's own best (lower number wins; equal rank means the root
 * already has a title of that level; an inside h1 short-circuits), and lift the
 * best rank. Among equal rank, the nearest to the body wins.
 *
 * Deck: when the nearest preceding heading is not the title, is strictly lower
 * rank than it, and sits under the same rules (not banner, not furniture), it
 * comes along as a second lifted node — a standfirst is part of how the page
 * titles itself, and the capture already takes a list. Only that one nearest
 * subordinate: sweeping every heading between title and body would also take a
 * bare section-nav h2 that is not wrapped in `<nav>`. Headings under furniture
 * (`nav` / `aside` / …) are never candidates, so a real contents nav is not
 * lifted. What the reader still loses: a deck written as a `<p class="dek">`
 * rather than an h2, and a second standfirst when two subordinate headings sit
 * between title and body (only the nearest rides along).
 */
function liftHeadings(
  root: Element,
  isVisible: (el: Element) => boolean,
): Element[] {
  // Best (lowest) h1–h2 level already under the root. null = none.
  const ownBest = bestOwnHeadingLevel(root, isVisible);
  // Nothing outside can outrank an h1 the body already carries.
  if (ownBest === 1) return [];

  const preceding = precedingHeadings(root, isVisible);
  if (preceding.length === 0) return [];

  // Title: best rank among those that outrank the body; nearest on a tie
  // (later in `preceding` is nearer the body, so equal rank overwrites).
  let title: Element | null = null;
  let titleRank: 1 | 2 | null = null;
  for (const h of preceding) {
    if (!outranksOwn(h, ownBest)) continue;
    const rank = headingRank(h);
    if (rank === null) continue;
    if (title === null || rank < titleRank! || rank === titleRank) {
      title = h;
      titleRank = rank;
    }
  }
  if (!title || titleRank === null) return [];

  const lifted: Element[] = [title];

  // Standfirst immediately above the body, when the title sat further up.
  const nearest = preceding[preceding.length - 1]!;
  if (nearest !== title) {
    const deckRank = headingRank(nearest);
    if (deckRank !== null && deckRank > titleRank) {
      lifted.push(nearest);
    }
  }

  return lifted;
}

/**
 * All h1–h2 that sit before `root` under the same sectioning parent, in
 * document order. Stops looking past another `<article>`; skips the page
 * banner and furniture wrappers.
 */
function precedingHeadings(
  root: Element,
  isVisible: (el: Element) => boolean,
): Element[] {
  const parent = sectioningParent(root);
  if (!parent) return [];

  const found: Element[] = [];

  // Previous siblings of the root, nearest first — unshift so the list ends in
  // document order (farthest … nearest).
  let sib: Element | null = root.previousElementSibling;
  while (sib) {
    if (sib.tagName.toLowerCase() === 'article') break;
    found.unshift(...headingsIn(sib, isVisible));
    sib = sib.previousElementSibling;
  }

  // Headings on previous siblings of ancestors still inside the sectioning parent
  // (title wrapped in a header/div above a nested article path).
  let probe: Element | null = root.parentElement;
  while (probe && probe !== parent) {
    let prev: Element | null = probe.previousElementSibling;
    const batch: Element[] = [];
    while (prev) {
      if (prev.tagName.toLowerCase() === 'article') break;
      batch.unshift(...headingsIn(prev, isVisible));
      prev = prev.previousElementSibling;
    }
    found.unshift(...batch);
    probe = probe.parentElement;
  }

  return found;
}

/** True when `heading` is a strictly higher rank than the root's best own level. */
function outranksOwn(heading: Element, ownBest: number | null): boolean {
  const level = headingRank(heading);
  if (level === null) return false;
  // No heading inside → any candidate outranks the void.
  if (ownBest === null) return true;
  return level < ownBest;
}

/** 1 for h1, 2 for h2; null for anything the lift does not consider. */
function headingRank(el: Element): 1 | 2 | null {
  const tag = el.tagName.toLowerCase();
  if (tag === 'h1') return 1;
  if (tag === 'h2') return 2;
  return null;
}

/**
 * Lowest h1–h2 rank under the root that is not furniture. null when none.
 * Only h1–h2: those are the levels the lift itself will consider outside.
 */
function bestOwnHeadingLevel(
  root: Element,
  isVisible: (el: Element) => boolean,
): 1 | 2 | null {
  let best: 1 | 2 | null = null;
  for (const h of root.querySelectorAll('h1, h2')) {
    if (!root.contains(h)) continue;
    if (!isVisible(h)) continue;
    if (insideFurniture(h, root)) continue;
    const rank = headingRank(h);
    if (rank === null) continue;
    if (best === null || rank < best) best = rank;
    if (best === 1) return 1;
  }
  return best;
}

/**
 * Body-level site-header ids used by older blogs that never wrote `<header>`.
 * Matched only when the element is not nested inside sectioning content — the
 * same rule as for `<header>` — so an in-article `#header` still contributes.
 * `#smallhead` is the concrete case: simonwillison.net puts the site name in
 * a div, and without this the block-fallback lift walked body and opened the
 * document on "Simon Willison's Weblog".
 */
const SITE_BANNER_ID =
  /^(header|site-?header|masthead|banner|top-?bar|smallhead|site-?title|branding)$/i;

const SITE_BANNER_CLASS =
  /\b(site-?header|masthead|site-branding)\b/i;

/**
 * The page-wide banner — site name, logo, top nav — not the article's title.
 *
 * `role="banner"` says so explicitly. A `<header>` that is not nested inside
 * sectioning content or `<main>` is the same thing: HTML puts the site header
 * as a child of `body` (or of a wrapper under body), while an article title
 * header sits inside `<main>` / `<article>` / `<section>`. Without this, the
 * lift walk reaches body as the sectioning parent and pulls "My Cool Website"
 * in as the document title. The same nesting rule applies to the body-level
 * site-header divs older blogs use in place of `<header>`.
 */
function isPageBanner(el: Element): boolean {
  const role = (el.getAttribute('role') ?? '').toLowerCase();
  if (role === 'banner') return true;

  const tag = el.tagName.toLowerCase();
  const id = el.getAttribute('id') ?? '';
  const className = el.getAttribute('class') ?? '';
  const looksLikeBanner =
    tag === 'header' ||
    SITE_BANNER_ID.test(id) ||
    SITE_BANNER_CLASS.test(className);
  if (!looksLikeBanner) return false;

  for (let p = el.parentElement; p; p = p.parentElement) {
    const t = p.tagName.toLowerCase();
    if (t === 'article' || t === 'aside' || t === 'nav' || t === 'section' || t === 'main') {
      return false;
    }
    if (t === 'body' || t === 'html') return true;
  }
  return true;
}

function isInsidePageBanner(el: Element, stop: Element): boolean {
  for (let p: Element | null = el; p && p !== stop; p = p.parentElement) {
    if (isPageBanner(p)) return true;
  }
  return false;
}

function hasHeadingLevel(
  root: Element,
  level: 'h1' | 'h2',
  isVisible: (el: Element) => boolean,
): boolean {
  for (const h of root.getElementsByTagName(level)) {
    if (isVisible(h) && !insideFurniture(h, root)) return true;
  }
  return false;
}

/**
 * h1–h2 under a preceding sibling/wrapper, in document order.
 * Banner and furniture scopes contribute nothing — those are site chrome.
 */
function headingsIn(scope: Element, isVisible: (el: Element) => boolean): Element[] {
  if (isPageBanner(scope)) return [];
  if (isFurnitureSignal(scope)) return [];
  const tag = scope.tagName.toLowerCase();
  if (tag === 'h1' || tag === 'h2') {
    return isVisible(scope) ? [scope] : [];
  }
  const out: Element[] = [];
  for (const h of scope.querySelectorAll('h1, h2')) {
    if (!isVisible(h)) continue;
    // A heading nested under a banner inside this wrapper is the site name.
    if (isInsidePageBanner(h, scope)) continue;
    if (isUnderFurniture(h, scope)) continue;
    out.push(h);
  }
  return out;
}

function isUnderFurniture(el: Element, stop: Element): boolean {
  for (let p: Element | null = el.parentElement; p && p !== stop; p = p.parentElement) {
    if (isFurnitureSignal(p)) return true;
  }
  return false;
}

function sectioningParent(el: Element): Element | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (SECTIONING.has(p.tagName.toLowerCase())) return p;
  }
  return null;
}

/**
 * Share of the root's *visible text* at which a furniture-tagged element is
 * treated as body rather than chrome.
 *
 * A quarter of the words: enough that a mis-tagged content column stays, while
 * a strip beside a long body does not. Measured in characters, not paragraphs
 * — on a three-paragraph post one newsletter `<p>` is already a third of the
 * paragraph count and would survive a pure count ratio, which is how
 * "Subscribe…" used to reach the Markdown under `mode: "selection"`.
 */
const FURNITURE_BODY_SHARE = 0.25;

/**
 * Absolute floor under which the share test does not protect an element.
 *
 * "Subscribe to our promo newsletter now" is a large share of a 200-character
 * root and must still be excluded. A real body column mis-classed as `aside`
 * clears this on its own prose. TOC is handled by {@link isTableOfContents}
 * and never reaches this test as something to drop.
 */
const FURNITURE_BODY_MIN_CHARS = 120;

/**
 * Furniture inside a wide root, as selectors `CaptureOptions.exclude` can drop
 * from the clone.
 *
 * Conjunction, not link density alone: a documentation table of contents and a
 * list of sources have the same density, and density alone would cut the wanted
 * half. An element is furniture when a semantic tag or a furniture class marks
 * it *and* it sits outside the accepted body (little of the root's visible
 * text, with an absolute floor so short posts cannot protect chrome by ratio)
 * *and* it is not a same-document table of contents.
 */
function furnitureSelectors(
  root: Element,
  isVisible: (el: Element) => boolean,
): string[] {
  const rootText = visibleTextLength(root, isVisible);
  const selectors: string[] = [];
  const seen = new Set<string>();

  for (const el of root.querySelectorAll('nav, aside, footer, [class]')) {
    if (el === root) continue;
    if (!isVisible(el)) continue;
    if (!isFurnitureSignal(el)) continue;
    if (isTableOfContents(el)) continue;
    // Holds a real share of the article's prose — it is the body, not chrome.
    if (holdsArticleBody(el, rootText, isVisible)) continue;
    // Nested furniture under already-listed furniture is redundant.
    if (selectors.some((s) => {
      try {
        return [...root.querySelectorAll(s)].some((listed) => listed.contains(el) && listed !== el);
      } catch {
        return false;
      }
    })) {
      continue;
    }
    const sel = uniqueSelector(el, root);
    if (!sel || seen.has(sel)) continue;
    seen.add(sel);
    selectors.push(sel);
  }

  return selectors;
}

/**
 * Whether a furniture-tagged element actually carries article body prose.
 * See {@link FURNITURE_BODY_SHARE} and {@link FURNITURE_BODY_MIN_CHARS}.
 */
function holdsArticleBody(
  el: Element,
  rootText: number,
  isVisible: (el: Element) => boolean,
): boolean {
  const elText = visibleTextLength(el, isVisible);
  if (elText < FURNITURE_BODY_MIN_CHARS) return false;
  if (rootText === 0) return false;
  return elText / rootText >= FURNITURE_BODY_SHARE;
}

function isFurnitureSignal(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag === 'nav' || tag === 'aside' || tag === 'footer') return true;
  const role = (el.getAttribute('role') ?? '').toLowerCase();
  if (role === 'navigation' || role === 'complementary' || role === 'contentinfo') {
    return true;
  }
  if (FURNITURE_CLASS.test(el.getAttribute('class') ?? '')) return true;
  // Language switcher, "also on the web" — interface no tag marks as such.
  return isOffDocumentLinkStrip(el);
}

/**
 * A dense strip of off-document links with essentially no prose of its own.
 *
 * Wikipedia's language button (`#p-lang-btn`) is the case that forced this:
 * eighty external language names, zero paragraphs, labelled "81 languages",
 * sitting beside the title inside `<main>` so the capture opened on chrome.
 * Distinguished from a references list or a "further reading" section by the
 * share of characters that are link labels (most of the strip) and by having
 * almost no `<p>` prose. Same-document TOC lists fail the external ratio and
 * are handled by {@link isTableOfContents}.
 */
function isOffDocumentLinkStrip(el: Element): boolean {
  const links = el.querySelectorAll('a[href]');
  if (links.length < 4) return false;

  // A title header that also holds a language switcher is not itself a strip —
  // Wikipedia's `vector-page-titlebar` wraps the h1 beside `#p-lang-btn`. Dropping
  // the whole header cost the document its title.
  if (el.querySelector('h1, h2, h3')) return false;

  const base = el.ownerDocument?.baseURI ?? undefined;
  const docUrl = documentAddress(el.ownerDocument);
  let total = 0;
  let external = 0;
  let linkTextLen = 0;
  for (const a of links) {
    const raw = a.getAttribute('href');
    if (raw === null || raw === '') continue;
    total += 1;
    if (!isSameDocumentFragment(raw, base, docUrl) && !isSameDocumentPage(raw, base, docUrl)) {
      external += 1;
    }
    linkTextLen += (a.textContent ?? '').replace(/\s+/g, ' ').trim().length;
  }
  if (total < 4 || external / total < 0.8) return false;

  // Visible text of the element, counting its own descendants. A strip whose
  // characters are mostly link labels is chrome; mixed prose is not.
  let elText = 0;
  const walk = (node: Node): void => {
    if (node.nodeType === 3) {
      elText += (node.textContent ?? '').replace(/\s+/g, ' ').trim().length;
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = (node as Element).tagName.toLowerCase();
    if (SKIP_TEXT_TAGS.has(tag)) return;
    for (let c = node.firstChild; c; c = c.nextSibling) walk(c);
  };
  walk(el);
  if (elText < 40) return false;
  if (linkTextLen / elText < 0.7) return false;

  // Two real paragraphs → more like a body "further reading" block.
  let paragraphs = 0;
  for (const p of el.getElementsByTagName('p')) {
    if ((p.textContent ?? '').trim().length > 0) paragraphs += 1;
    if (paragraphs >= 2) return false;
  }
  return true;
}

/**
 * Same document at the page level (path + query), including bare paths without
 * a fragment. Used by the off-document link strip so an in-site nav of ordinary
 * links is not mistaken for a language switcher; fragment-only comparison is
 * the wrong test there because a nav to `/about` is same-site but not a TOC.
 */
function isSameDocumentPage(
  rawHref: string,
  baseURI: string | undefined,
  docUrl: URL | null,
): boolean {
  if (!docUrl) {
    return rawHref.startsWith('#') || rawHref.startsWith('/') || !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(rawHref);
  }
  try {
    const resolved = baseURI ? new URL(rawHref, baseURI) : new URL(rawHref, docUrl.href);
    const linkKey = resolved.origin + resolved.pathname + resolved.search;
    const docKey = docUrl.origin + docUrl.pathname + docUrl.search;
    // Same path, or a same-origin path without claiming a different site.
    if (linkKey === docKey) return true;
    return resolved.origin === docUrl.origin;
  } catch {
    return rawHref.startsWith('#') || rawHref.startsWith('/');
  }
}

function insideFurniture(el: Element, root: Element): boolean {
  for (let p: Element | null = el.parentElement; p && p !== root; p = p.parentElement) {
    if (isFurnitureSignal(p)) return true;
  }
  return false;
}

/**
 * A list of same-document fragment links — the documentation table of contents
 * the corpus requires to survive.
 *
 * Class names alone are not enough. Wikipedia's titlebar control is
 * `class="… vector-toc-landmark"` with a "Toggle the table of contents" button
 * and zero fragment links; the old class short-circuit protected that chrome
 * and the capture opened on the toggle label. A document TOC (MDN's
 * `reference-toc`, the hand-written `docs-toc-survives` fixture) still has a
 * real list of in-page `#` links and passes the ratio. Site chrome that also
 * happens to list the headings (Wikipedia's sidebar) sits *outside* the
 * article root on pages that mark `<main>`, and when it does fall inside a
 * wide root it is furniture for the same reason the titlebar is: the reader
 * already gets a TOC from the headings themselves. We do not special-case the
 * sidebar further — the link test alone would still call it a TOC, which is
 * the honest reading of a fragment list; exclusion there depends on it not
 * being the chosen root's body.
 */
function isTableOfContents(el: Element): boolean {
  const links = el.querySelectorAll('a[href]');
  if (links.length < 2) return false;
  let internal = 0;
  let total = 0;
  const base = el.ownerDocument?.baseURI ?? undefined;
  const docUrl = documentAddress(el.ownerDocument);
  for (const a of links) {
    const raw = a.getAttribute('href');
    if (raw === null || raw === '') continue;
    total += 1;
    if (isSameDocumentFragment(raw, base, docUrl)) internal += 1;
  }
  return total > 0 && internal / total >= 0.6;
}

function documentAddress(doc: Document | null): URL | null {
  if (!doc) return null;
  const raw = doc.URL || doc.documentURI || doc.baseURI;
  if (!raw) return null;
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function isSameDocumentFragment(
  rawHref: string,
  baseURI: string | undefined,
  docUrl: URL | null,
): boolean {
  if (!docUrl) {
    // No document address: only a bare hash is "internal" enough for TOC.
    return rawHref.startsWith('#') && rawHref.length > 1;
  }
  try {
    const resolved = baseURI ? new URL(rawHref, baseURI) : new URL(rawHref, docUrl.href);
    if (!resolved.hash || resolved.hash === '#') return false;
    const linkKey = resolved.origin + resolved.pathname + resolved.search;
    const docKey = docUrl.origin + docUrl.pathname + docUrl.search;
    return linkKey === docKey;
  } catch {
    return rawHref.startsWith('#') && rawHref.length > 1;
  }
}

function uniqueSelector(el: Element, root: Element): string | null {
  const id = el.getAttribute('id');
  if (id && !/["'\\]/.test(id)) {
    const sel = `#${cssEscapeIdent(id)}`;
    try {
      if (root.querySelectorAll(sel).length === 1) return sel;
    } catch {
      // fall through
    }
  }

  const tag = el.tagName.toLowerCase();
  const className = el.getAttribute('class') ?? '';
  const tokens = className
    .trim()
    .split(/\s+/)
    .filter((t) => t && !/["'\\]/.test(t));
  // Furniture-class tokens first, then any class. A class that matches a few
  // siblings (Wikipedia pins the same tools nav in the toolbar and the column)
  // is better than an nth-of-type path: exclude runs the selectors in order,
  // and removing one nav shifts the index of the next so the path misses.
  // A class token that may match several pinned/unpinned copies of the same
  // chrome (Wikipedia tools nav). Generic tokens like `container` must stay
  // unique-only, or a single furniture hit would drop four layout columns.
  const MULTI_MATCH_CLASS = /landmark|portlet|pinnable|tools|appearance/i;
  const ordered = [
    ...tokens.filter((t) => FURNITURE_CLASS.test(t)),
    ...tokens,
  ];
  const seenToken = new Set<string>();
  for (const token of ordered) {
    if (seenToken.has(token)) continue;
    seenToken.add(token);
    const sel = `${tag}.${cssEscapeIdent(token)}`;
    try {
      const n = root.querySelectorAll(sel).length;
      if (n === 1) return sel;
      if (n > 1 && n <= 4 && MULTI_MATCH_CLASS.test(token)) return sel;
    } catch {
      // fall through
    }
  }

  // nth-of-type path from root — last resort. Fragile under sequential
  // exclusion of siblings; prefer ids and classes above whenever possible.
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur !== root) {
    const parentEl: Element | null = cur.parentElement;
    if (!parentEl) break;
    const name = cur.tagName.toLowerCase();
    let index = 1;
    for (let s = cur.previousElementSibling; s; s = s.previousElementSibling) {
      if (s.tagName === cur.tagName) index += 1;
    }
    parts.unshift(`${name}:nth-of-type(${index})`);
    cur = parentEl;
  }
  if (parts.length === 0) return null;
  return parts.join(' > ');
}

/** Minimal CSS.escape for idents; full CSS.escape is not in every test DOM. */
function cssEscapeIdent(ident: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(ident);
  }
  return ident.replace(/([^\w-])/g, '\\$1');
}

/**
 * Visible text length. Skips non-prose tags; asks `isVisible` per element so a
 * browser can inject the real cascade and the test harness can pass "always".
 */
export function visibleTextLength(
  root: Element,
  isVisible: (el: Element) => boolean = () => true,
): number {
  if (!isVisible(root)) return 0;
  let total = 0;
  const walk = (node: Node): void => {
    if (node.nodeType === 3 /* TEXT_NODE */) {
      total += (node.textContent ?? '').replace(/\s+/g, ' ').trim().length;
      return;
    }
    if (node.nodeType !== 1 /* ELEMENT_NODE */) return;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (SKIP_TEXT_TAGS.has(tag)) return;
    if (!isVisible(el)) return;
    for (let c = el.firstChild; c; c = c.nextSibling) walk(c);
  };
  for (let c = root.firstChild; c; c = c.nextSibling) walk(c);
  return total;
}

function countParagraphs(
  root: Element,
  isVisible: (el: Element) => boolean,
): number {
  let n = 0;
  for (const p of root.getElementsByTagName('p')) {
    if (!isVisible(p)) continue;
    if ((p.textContent ?? '').trim().length === 0) continue;
    n += 1;
  }
  return n;
}

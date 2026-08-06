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
   * preceding heading and then the root (see heading lift below).
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
  // twelve teasers glued together.
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

  const heading = liftHeading(winner.el, isVisible);
  const nodes = heading ? [heading, winner.el] : [winner.el];
  if (heading && heading.tagName.toLowerCase() === 'h1') {
    metrics.hasH1 = true;
  }

  return {
    ok: true,
    nodes,
    exclude: furnitureSelectors(winner.el, isVisible),
    metrics,
  };
}

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

  return out;
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
 * Nearest preceding h1–h2 when the root has no heading of its own.
 *
 * Only a heading element, never a whole chrome region. Same sectioning parent,
 * no other `<article>` between them. The article's title is the one immediately
 * above the body *inside the same section* (`<main><h1>…</h1><article>`); the
 * site's name lives in the page banner and must not be lifted — that is the
 * ordinary blog `<body><header><h1>Site</h1></header><article>` shape, which
 * has no `<main>` and would otherwise open the document on the site name.
 */
function liftHeading(
  root: Element,
  isVisible: (el: Element) => boolean,
): Element | null {
  if (hasOwnHeading(root, isVisible)) return null;

  const parent = sectioningParent(root);
  if (!parent) return null;

  // Walk previous siblings and their descendants from the end, looking for the
  // nearest heading that still sits under the same sectioning parent.
  let sib: Element | null = root.previousElementSibling;
  while (sib) {
    if (sib.tagName.toLowerCase() === 'article') return null;
    const heading = lastHeadingIn(sib, isVisible);
    if (heading) return heading;
    sib = sib.previousElementSibling;
  }

  // Parent may hold the heading as a direct structure above nested wrappers.
  // Only accept a heading that is a previous sibling of some ancestor chain
  // member still inside `parent`.
  let probe: Element | null = root.parentElement;
  while (probe && probe !== parent) {
    let prev: Element | null = probe.previousElementSibling;
    while (prev) {
      if (prev.tagName.toLowerCase() === 'article') return null;
      const heading = lastHeadingIn(prev, isVisible);
      if (heading) return heading;
      prev = prev.previousElementSibling;
    }
    probe = probe.parentElement;
  }

  return null;
}

/**
 * The page-wide banner — site name, logo, top nav — not the article's title.
 *
 * `role="banner"` says so explicitly. A `<header>` that is not nested inside
 * sectioning content or `<main>` is the same thing: HTML puts the site header
 * as a child of `body` (or of a wrapper under body), while an article title
 * header sits inside `<main>` / `<article>` / `<section>`. Without this, the
 * lift walk reaches body as the sectioning parent and pulls "My Cool Website"
 * in as the document title.
 */
function isPageBanner(el: Element): boolean {
  const role = (el.getAttribute('role') ?? '').toLowerCase();
  if (role === 'banner') return true;
  if (el.tagName.toLowerCase() !== 'header') return false;
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

function hasOwnHeading(root: Element, isVisible: (el: Element) => boolean): boolean {
  for (const h of root.querySelectorAll('h1, h2')) {
    if (!root.contains(h)) continue;
    if (!isVisible(h)) continue;
    // A heading inside nested furniture does not count as the article's own.
    if (insideFurniture(h, root)) continue;
    return true;
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

function lastHeadingIn(root: Element, isVisible: (el: Element) => boolean): Element | null {
  // Never lift anything out of the page banner — that is the site name.
  if (isPageBanner(root)) return null;
  const tag = root.tagName.toLowerCase();
  if ((tag === 'h1' || tag === 'h2') && isVisible(root)) return root;
  const headings = root.querySelectorAll('h1, h2');
  for (let i = headings.length - 1; i >= 0; i--) {
    const h = headings[i]!;
    if (!isVisible(h)) continue;
    // A heading nested under a banner inside this wrapper is the site name.
    if (isInsidePageBanner(h, root)) continue;
    return h;
  }
  return null;
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
  return FURNITURE_CLASS.test(el.getAttribute('class') ?? '');
}

function insideFurniture(el: Element, root: Element): boolean {
  for (let p: Element | null = el.parentElement; p && p !== root; p = p.parentElement) {
    if (isFurnitureSignal(p)) return true;
  }
  return false;
}

/**
 * A nav whose links mostly jump inside this document — the documentation TOC
 * the corpus requires to survive. External "read next" strips fail this.
 */
function isTableOfContents(el: Element): boolean {
  const className = el.getAttribute('class') ?? '';
  if (/\b(toc|table-of-contents|document-toc)\b/i.test(className)) return true;

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
  const token = className
    .trim()
    .split(/\s+/)
    .find((t) => t && FURNITURE_CLASS.test(t) && !/["'\\]/.test(t));
  if (token) {
    const sel = `${tag}.${cssEscapeIdent(token)}`;
    try {
      if (root.querySelectorAll(sel).length === 1) return sel;
    } catch {
      // fall through
    }
  }

  // nth-of-type path from root — last resort, stable for a single capture.
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

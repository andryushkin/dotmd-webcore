/**
 * The links of a rendered document: which of them point back into it, and which
 * leave.
 *
 * A note rendered by this package came from a page, and the anchors in it still
 * carry that page's addresses. Two of them need work that nothing else can do.
 *
 * ## The ones that leave
 *
 * They get `target="_blank"` and `rel="noopener noreferrer"`. A rendered note is
 * shown inside something — a preview panel, a reading overlay that is a modal on
 * the page underneath — and a link that navigates in place carries that whole
 * thing off to another site. The clipper's preview shipped without this and did
 * exactly that. Note what is *not* here: nothing in this file navigates, opens a
 * tab or assigns a location. It writes markup onto the document, and the browser
 * does the rest — the one product decision that remains, what happens when a
 * reader activates an in-document link, arrives as a callback.
 *
 * ## The ones that point back in
 *
 * By the time markup is rendered, an internal link is not `#foo` any more:
 * `resolveUrl` in `htmltodotmd` has already run every relative address through
 * `new URL(url, baseUrl)`, so it arrives absolute. `href.startsWith('#')` never
 * fires on converted markup, and a bare `#id` would not have been trustworthy
 * either — under `<base href="https://cdn.example/…">` it resolves into another
 * document altogether. The test is the one `collectFragmentIds` uses on the live
 * page: resolve, drop the hash from both addresses, compare
 * `origin + pathname + search`.
 *
 * And the id it points at is gone. The round trip through Markdown loses every
 * `id` the page had; what this package printed instead is a slug of the heading's
 * text, uniquified within the render. So the join is by text, in two halves that
 * meet here for the first time:
 *
 *   live page  → `collectFragmentIds` → original id, tag, heading *text*
 *   this note  → `RenderResult.headings` → level, plain text, printed id
 *
 * `pagetodotmd` hands over text and no slug on purpose — a second slug
 * implementation is the drift the packages' "keep in sync" list exists to
 * prevent — and this side owns `headingSlug`, so this side does the joining.
 *
 * ## What the join cannot do
 *
 * A target that is not a heading — a paragraph, a figure, a footnote item — has
 * no counterpart in the rendered note. Nothing carries that id any more, and
 * nothing can be made to. The honest answer is to leave the link pointing at the
 * page it came from, which is what an unjoined internal link gets: the same
 * treatment as an external one. Scrolling to nothing looks like a broken control
 * and tells the reader the note is damaged.
 */
import { headingSlug } from './heading-slug.js';
import type { RenderedHeading } from './heading-ids.js';

/**
 * One fragment target as the live page reported it.
 *
 * Structurally what `pagetodotmd`'s `collectFragmentIds` hands back, declared
 * here rather than imported: this package depends on nothing, which is the same
 * reason `pagetodotmd` refuses to depend on this one, and a package that has to
 * be installed to read a *type* is a dependency in every way that matters to a
 * consumer's bundle. Only the two fields the join reads are named, so anything
 * that package adds to its own type still fits. The two are a pair all the same,
 * and the repository's "keep in sync" list says so: were `headingText` renamed
 * over there, an optional property would go on satisfying this shape and every
 * internal link would quietly stop joining.
 */
export interface HeadingFragmentTarget {
  /** The original `id` attribute value, as the live page carried it. */
  readonly id: string;
  /** Visible text of the heading, when the target was one. Absent otherwise. */
  readonly headingText?: string;
}

/**
 * Original fragment id → the id this render actually printed.
 *
 * Matches each target that carries heading text to the next unused heading with
 * the same plain text, so two sections both titled "Intro" consume `intro` and
 * `intro-1` in document order rather than both claiming the first. Uniqueness is
 * read off the headings list and never invented here: the suffix that parts two
 * headings is the renderer's answer, and a second rule for it on this side is
 * the drift one walk of one token tree exists to prevent.
 *
 * `headingSlug` is consulted only after plain-text equality has failed. The two
 * halves are produced by different packages reading different trees — one the
 * live DOM, one a Markdown token stream — so whitespace and conversion drift is
 * ordinary, and the slug is the normal form both sides agree on. A target with
 * no heading text is skipped outright; see the file header.
 */
export function buildHeadingFragmentMap(
  fragmentIds: readonly HeadingFragmentTarget[],
  headings: readonly RenderedHeading[],
): Map<string, string> {
  const map = new Map<string, string>();
  // Consumed as they match, so two "Intro" targets take intro and intro-1.
  const remaining: RenderedHeading[] = headings.slice();

  for (const target of fragmentIds) {
    if (target.headingText === undefined) continue;
    const text = target.headingText;
    let idx = remaining.findIndex((h) => h.text === text);
    if (idx < 0) {
      const base = headingSlug(text);
      if (base !== '') {
        // The base the renderer would have minted before uniquifying, which is
        // also what an already-uniquified id starts with.
        idx = remaining.findIndex(
          (h) => headingSlug(h.text) === base || h.id === base || h.id.startsWith(`${base}-`),
        );
      }
    }
    if (idx < 0) continue;
    const matched = remaining[idx]!;
    remaining.splice(idx, 1);
    map.set(target.id, matched.id);
  }

  return map;
}

/** Everything `wireDocumentLinks` needs that it cannot read off the markup. */
export interface WireDocumentLinksOptions {
  /**
   * The address the note was captured from — `location.href` at capture time.
   * Compared without its hash, the way `collectFragmentIds` compares.
   */
  documentUrl: string;
  /**
   * `document.baseURI` at capture, which resolves relative addresses the way the
   * converter did. Not the same as `documentUrl` on a page that set `<base>`.
   * Defaults to `documentUrl`.
   */
  baseURI?: string;
  /** Fragment targets from the live page. Per capture — never cached across two. */
  fragmentIds: readonly HeadingFragmentTarget[];
  /** This render's headings, from `RenderResult.headings`. */
  headings: readonly RenderedHeading[];
  /**
   * Where to look for a heading when an internal link is activated. Defaults to
   * `root`, which is the mount container in the ordinary case; a product whose
   * document is nested deeper hands over the scope that holds the headings.
   */
  documentRoot?: ParentNode;
  /**
   * What activating an internal heading link does.
   *
   * The one product decision in this file, and the reason it is a parameter: an
   * overlay scrolls its own shell, a panel scrolls a pane, and a page scrolls
   * itself. The default is `scrollIntoView` on the heading, which is exactly what
   * the `href` this function writes already promises.
   */
  onScrollTo?: (headingId: string) => void;
}

/**
 * Classify every `a[href]` under `root`, and give each the markup its class
 * calls for.
 *
 * Three verdicts, two of which look identical from outside: a link that leaves
 * the document and an internal link that could not be joined both keep their
 * original address and open in a new tab. Only a link onto a heading this render
 * printed is rewritten — its `href` becomes the id that is actually in the
 * markup, so middle-click and "copy link" hand a reader a working anchor, and a
 * plain click is intercepted and answered by `onScrollTo`.
 *
 * Re-wiring the same nodes adds a second click listener. That is harmless here —
 * both listeners prevent the same default and scroll to the same heading — and
 * the ordinary case does not arise: a consumer that renders again writes new
 * markup into the container, and the old listeners die with the nodes they were
 * on. A `documentUrl` that is not a URL leaves every link exactly as it was:
 * without it nothing can be classified, and guessing would mean rewriting
 * addresses on no evidence.
 */
export function wireDocumentLinks(root: ParentNode, options: WireDocumentLinksOptions): void {
  const docUrl = parseUrl(options.documentUrl);
  if (!docUrl) return;

  const baseURI = options.baseURI || options.documentUrl;
  const fragmentMap = buildHeadingFragmentMap(options.fragmentIds, options.headings);
  const docKey = addressKey(docUrl);
  const onScrollTo = options.onScrollTo;
  const documentRoot = options.documentRoot ?? root;

  for (const node of Array.from(root.querySelectorAll('a[href]'))) {
    const link = node as Element;
    const raw = link.getAttribute('href');
    if (raw === null || raw === '') continue;

    const resolved = resolveHref(raw, baseURI, docUrl);
    if (!resolved) continue;

    // Same document, and a fragment to look up — everything else leaves.
    if (addressKey(resolved) !== docKey || !resolved.hash || resolved.hash === '#') {
      leavesTheDocument(link);
      continue;
    }

    const headingId = fragmentMap.get(decodeFragment(resolved.hash.slice(1)));
    if (headingId === undefined) {
      // A non-heading target, or a heading the join could not reach.
      leavesTheDocument(link);
      continue;
    }

    link.setAttribute('href', `#${headingId}`);
    link.removeAttribute('target');
    link.removeAttribute('rel');
    link.addEventListener('click', (event) => {
      event.preventDefault();
      if (onScrollTo) {
        onScrollTo(headingId);
        return;
      }
      const target = findById(documentRoot, headingId) as { scrollIntoView?: unknown } | null;
      if (target && typeof target.scrollIntoView === 'function') {
        (target.scrollIntoView as (arg: ScrollIntoViewOptions) => void)({ block: 'start' });
      }
    });
  }
}

/**
 * The one element in a tree that carries an id.
 *
 * `getElementById` is a `Document` method and a rendered note is often not in
 * one — a reading overlay puts its document inside a shadow root, where the
 * lookup index does not reach. So: ask for the index where there is one, then
 * the root itself, then walk `[id]`. Three copies of this walk existed in one
 * consumer, each with a slightly different idea of the first two steps.
 *
 * No `instanceof Element` in the middle step, though that is the obvious way to
 * write it: `Element` is a global, this package may not read one, and there are
 * environments where it is simply not defined. Whether a node answers
 * `getAttribute` is the same question asked of the object in hand.
 */
export function findById(root: ParentNode, id: string): Element | null {
  const byIndex = (root as Partial<Document>).getElementById;
  if (typeof byIndex === 'function') {
    const el = byIndex.call(root as Document, id);
    if (el) return el;
  }
  const self = root as Partial<Element>;
  if (typeof self.getAttribute === 'function' && self.getAttribute.call(root, 'id') === id) {
    return root as Element;
  }
  for (const el of Array.from(root.querySelectorAll?.('[id]') ?? [])) {
    if (el.getAttribute('id') === id) return el;
  }
  return null;
}

/**
 * A link out of the note: open elsewhere, and never in whatever is showing this.
 *
 * `noopener` as well as `_blank` because the opened page would otherwise hold
 * `window.opener` on the document a reader is in the middle of.
 */
function leavesTheDocument(link: Element): void {
  link.setAttribute('target', '_blank');
  link.setAttribute('rel', 'noopener noreferrer');
}

function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function resolveHref(raw: string, baseURI: string, docUrl: URL): URL | null {
  try {
    return new URL(raw, baseURI || docUrl.href);
  } catch {
    return null;
  }
}

/**
 * `origin + pathname + search`, no hash — the same key `collectFragmentIds` uses
 * on the live page, and it has to stay the same one.
 *
 * Nothing is decoded and no trailing slash is folded: `%2F` is not `/`, and
 * whether `/a` and `/a/` are one page is the server's to say, not ours.
 */
function addressKey(url: URL): string {
  return url.origin + url.pathname + url.search;
}

/** `#caf%C3%A9` names the id `café`; a malformed encoding stands as written. */
function decodeFragment(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

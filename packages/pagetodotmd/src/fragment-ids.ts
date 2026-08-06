/**
 * Map of internal fragment targets on a live page — free function, not a field
 * on the capture result.
 *
 * The Markdown round trip loses `id`s (`normalizeFragment` in htmltodotmd strips
 * cloned ids), so `#anchor` links stop working. The map from an original `id` to
 * what it should become has to be taken from the live page: after conversion
 * there is nothing left to rebuild it from, and the engine has no sourcemap.
 *
 * **Do not compute a slug here.** The slug an anchor must end up matching is
 * printed by `dotmdtohtml` when it renders the document. This package does not
 * depend on `dotmdtohtml` and must not start to — a second slug implementation
 * is exactly the drift CLAUDE.md warns about under "Keep in sync". What this
 * hands back is the identifying material only: the original `id`, the element's
 * tag name, and its heading text where the target *is* a heading. The consumer
 * joins that to the rendered document by text.
 *
 * A target that is not a heading (a paragraph, a figure, a footnote item) has
 * no counterpart after the round trip. The honest behaviour is to leave that
 * link pointing at the original page — this function still reports the target
 * so a consumer can see it, and sets no heading text for it.
 *
 * Internal-ness is one rule for both bare hashes and absolute URLs. By the time
 * anything is rendered, `resolveUrl` in htmltodotmd has already run every
 * relative through `new URL(url, baseUrl)`, so a `href.startsWith('#')` test
 * never fires on the converted markup. And a raw `#id` is not "internal" either:
 * with `<base href="https://cdn.example/…">` the fragment resolves against that
 * base and points into another document. So: resolve every `href` through
 * `new URL(raw, document.baseURI)`, drop the hash from both the link and the
 * *document* address (`document.URL`, not `baseURI`), and compare the serialized
 * `origin + pathname + search`. Equal — internal. Do not decode the path or the
 * query, and do not equate `/a` with `/a/`: `%2F` is not `/`, a trailing slash is
 * the server's to distinguish, and `URL.href` already gives the canonical form.
 */

/** One internal fragment target found on the live page. */
export interface FragmentTarget {
  /** The original `id` attribute value (after fragment percent-decoding). */
  id: string;
  /** Lower-cased tag name of the element that carries the id. */
  tag: string;
  /**
   * Visible text of the heading when the target is `h1`–`h6`.
   *
   * Absent for every other tag: there is nothing in the rendered Markdown that
   * corresponds to a non-heading id, and inventing a slug here would couple this
   * package to `dotmdtohtml`'s heading printer.
   */
  headingText?: string;
}

export interface CollectFragmentIdsOptions {
  /**
   * Scope to search for targets and for links. Defaults to the whole document.
   * A consumer that already knows the article root passes it so ids outside the
   * capture are not reported as joinable.
   */
  root?: Element | Document;
}

/**
 * Collect internal fragment targets that live links on this page point at.
 *
 * Percent-encoded fragments are decoded for lookup (`#caf%C3%A9` → id `café`);
 * `decodeURIComponent` can throw on malformed input, and a bad encoding is kept
 * as the raw fragment so a matching literal id still works.
 */
export function collectFragmentIds(
  doc: Document,
  options: CollectFragmentIdsOptions = {},
): FragmentTarget[] {
  const scope: Element | Document = options.root ?? doc;
  const baseURI = doc.baseURI;
  const docUrl = documentAddress(doc);
  const wanted = new Set<string>();

  const linksRoot: ParentNode =
    scope.nodeType === 9 /* DOCUMENT_NODE */
      ? (scope as Document)
      : (scope as Element);

  for (const a of linksRoot.querySelectorAll('a[href]')) {
    const raw = a.getAttribute('href');
    if (raw === null || raw === '') continue;
    const fragment = internalFragment(raw, baseURI, docUrl);
    if (fragment !== null) wanted.add(fragment);
  }

  const out: FragmentTarget[] = [];
  const seen = new Set<string>();
  for (const id of wanted) {
    if (seen.has(id)) continue;
    const el = findById(scope, doc, id);
    if (!el) continue;
    seen.add(id);
    const tag = el.tagName.toLowerCase();
    const target: FragmentTarget = { id, tag };
    if (/^h[1-6]$/.test(tag)) {
      const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (text !== '') target.headingText = text;
    }
    out.push(target);
  }

  // Stable document order for consumers that join by walking the rendered tree.
  out.sort((a, b) => {
    const ea = doc.getElementById(a.id);
    const eb = doc.getElementById(b.id);
    if (!ea || !eb) return a.id.localeCompare(b.id);
    const pos = ea.compareDocumentPosition(eb);
    if (pos & 4 /* DOCUMENT_POSITION_FOLLOWING */) return -1;
    if (pos & 2 /* DOCUMENT_POSITION_PRECEDING */) return 1;
    return 0;
  });

  return out;
}

function documentAddress(doc: Document): URL | null {
  // The document's own address, not baseURI. baseURI is only for resolving the
  // href; comparing against it would call a fragment that points at a CDN "same
  // document" whenever the page set <base href="https://cdn…">.
  const raw = doc.URL || doc.documentURI;
  if (!raw) {
    try {
      return doc.baseURI ? new URL(doc.baseURI) : null;
    } catch {
      return null;
    }
  }
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/**
 * The fragment identifier when `rawHref` resolves to the same document, else
 * null. Path and query are compared as `URL` serialises them — no decoding, no
 * trailing-slash folding.
 */
function internalFragment(
  rawHref: string,
  baseURI: string,
  docUrl: URL | null,
): string | null {
  if (!docUrl) return null;
  let resolved: URL;
  try {
    resolved = new URL(rawHref, baseURI || docUrl.href);
  } catch {
    return null;
  }
  const hash = resolved.hash;
  if (!hash || hash === '#') return null;

  const linkKey = resolved.origin + resolved.pathname + resolved.search;
  const docKey = docUrl.origin + docUrl.pathname + docUrl.search;
  if (linkKey !== docKey) return null;

  return decodeFragment(hash.slice(1));
}

function decodeFragment(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    // Malformed percent-encoding: keep the source so a literal id can still match.
    return raw;
  }
}

function findById(
  scope: Element | Document,
  doc: Document,
  id: string,
): Element | null {
  // document.getElementById is the browser's id map; scoped trees fall back to
  // a walk because getElementById is not defined on Element in every DOM.
  if (scope === doc || scope.nodeType === 9) {
    return doc.getElementById(id);
  }
  const root = scope as Element;
  if (root.id === id) return root;
  // [id="…"] needs CSS.escape for unusual ids; attribute walk is exact.
  for (const el of root.querySelectorAll('[id]')) {
    if (el.getAttribute('id') === id) return el;
  }
  return null;
}

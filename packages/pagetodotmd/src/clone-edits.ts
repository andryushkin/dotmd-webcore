/**
 * Optional edits a consumer may run on a capture's clone.
 *
 * Neither is applied by this package. The clipper's invariants say the opposite
 * of both — a collapsed `<details>` contributes its summary alone, and an
 * image's address is whatever the markup lists — so the mechanism lives here and
 * the product that wants a reading-mode document flips it on. Both edit the
 * clone only: the live page is never touched, which is what keeps a site's own
 * `toggle` handlers, `<details name>` groups and lazy-load observers out of the
 * capture path.
 */

/**
 * Sets `open` on every `<details>` in the fragment.
 *
 * The converter decides "collapsed" from the absence of the attribute, not from
 * computed style (`htmltodotmd` `sanitizer.ts`, `foldCollapsedDetails` /
 * `foldedDetailsContent`): a closed body still computes `display: block` and
 * `visibility: visible`, so a style snapshot cannot say what the reader saw.
 * Writing the attribute on the clone is therefore the whole of the answer, and
 * it is enough — nothing on the live page moves, no `toggle` fires, and a
 * `<details name>` group does not close its sibling.
 */
export function openDetails(fragment: ParentNode): void {
  for (const el of Array.from(fragment.querySelectorAll('details'))) {
    el.setAttribute('open', '');
  }
}

/**
 * Every attribute `extractImageUrl` in `htmltodotmd` reads as an address, other
 * than `src` itself — that is the one a reading-mode product rewrites.
 *
 * PAIR with `packages/htmltodotmd/src/rules/inline.ts` → `extractImageUrl`.
 * Writing `src` alone changes nothing: that function reads `data-src` and
 * friends first, then `srcset` (picking the largest descriptor), and only then
 * `src`. If a future edit teaches it a new source of an address, this list must
 * gain the same name or the reader silently gets the largest `srcset` variant
 * again. Never "every `data-*`": pages keep meaningful content under that
 * prefix, and stripping those is not this function's job.
 *
 * `data-noscript-src` is kept even though the sanitizer only writes it *during*
 * conversion (`hoistNoscriptImageSrc`), after `prepareClone` has already run —
 * so a clone at hook time almost never carries it. It is still on the list
 * because `extractImageUrl` still reads it: a page or an earlier tool that put
 * the name on the live element would otherwise keep an address this pass was
 * meant to replace, and `removeAttribute` of a name that is not there is free.
 * The signature key includes it for the same single-spelling reason.
 */
export const IMAGE_ADDRESS_ATTRS = [
  'data-src',
  'data-original',
  'data-lazy-src',
  'data-full-src',
  'data-hi-res-src',
  'data-srcset',
  'srcset',
  'data-noscript-src',
] as const;

/**
 * The single spelling of the key that pairs a live `<img>` to its clone.
 *
 * A clone carries the live element's attributes and nothing that would identify
 * the live node by identity, so the address attributes themselves are the
 * match: `src` plus every name in `IMAGE_ADDRESS_ATTRS`. Two images with the
 * same address attributes are the same image to the reader, and their
 * `currentSrc` is the same value, so a map collision is harmless by
 * construction. Both `collectCurrentSrc` and `materializeCurrentSrc` call this
 * and nothing else — a second spelling of the key is the drift this repository
 * has a whole section about.
 */
export function imageAddressSignature(img: Element): string {
  // Fixed order, every slot always present (empty when the attribute is
  // missing): two images that differ only by which of two equivalent attrs
  // they use must not hash the same, and a sparse encoding would make the
  // empty and the absent cases two keys for one element.
  const parts: string[] = [`src=${(img.getAttribute('src') ?? '').trim()}`];
  for (const name of IMAGE_ADDRESS_ATTRS) {
    parts.push(`${name}=${(img.getAttribute(name) ?? '').trim()}`);
  }
  return parts.join('\n');
}

/**
 * Whether a URL is only a loading stand-in, not a picture.
 *
 * PAIR with `isPlaceholder` in `packages/htmltodotmd/src/rules/inline.ts` —
 * same three arms, same order. That predicate is local to the image rule and
 * is not on the snapshot / selection / main surfaces `engine.ts` is allowed to
 * name; reaching past those entries would be a deep import, which the package
 * boundary forbids. The address-attribute list above is the same shape of pair
 * for the same reason. Restate the verdict here with this marker rather than
 * paste a half of it (the earlier `data:`-only check was that half, and it let
 * `loading.gif` / `spacer.png` through while the converter still called them
 * placeholders). A third spelling is the defect "Keep in sync" is about.
 */
function isPlaceholderSrc(src: string): boolean {
  return (
    src.startsWith('data:image/') ||
    /placeholder|spacer|1x1|blank|loading/i.test(src) ||
    (src.length < 50 && src.startsWith('data:'))
  );
}

/**
 * Whether a live `currentSrc` is worth carrying onto the clone as the picture
 * the document should hold.
 *
 * This function promises the **picture**, not the pixels the reader may still
 * be looking at. A lazy loader that has not fired leaves `currentSrc` on the
 * placeholder in `src`; writing that over and stripping `data-src` throws away
 * the only copy of the real address — exactly what `extractImageUrl` prefers
 * for this markup. Empty and whitespace-only are not addresses. A value the
 * paired placeholder verdict refuses is not a picture either.
 */
function isUsableCurrentSrc(src: string): boolean {
  const value = src.trim();
  if (!value) return false;
  if (isPlaceholderSrc(value)) return false;
  return true;
}

/**
 * Lazy-load attributes `extractImageUrl` reads before `src` — the ones that
 * still hold the real address while the browser has not adopted it into
 * `currentSrc`. Subset of {@link IMAGE_ADDRESS_ATTRS}; srcset is not a single
 * URL and is handled by materializing a real `currentSrc` when the browser
 * picked one.
 */
const LAZY_SRC_ATTRS = [
  'data-src',
  'data-original',
  'data-lazy-src',
  'data-full-src',
  'data-hi-res-src',
] as const;

/**
 * True when `currentSrc` still names the markup `src` (or a relative form of
 * it) while a lazy-load attribute holds a different address the browser has
 * not adopted. In that state the loader has not fired: materializing would
 * keep the placeholder and drop the picture.
 */
function lazyLoaderStillPending(img: Element, live: string): boolean {
  let lazy = '';
  for (const name of LAZY_SRC_ATTRS) {
    const v = (img.getAttribute(name) ?? '').trim();
    if (v) {
      lazy = v;
      break;
    }
  }
  if (!lazy || isPlaceholderSrc(lazy)) return false;
  // Browser already selected the lazy address (or a resolution of it).
  if (addressRefersTo(live, lazy)) return false;
  const src = (img.getAttribute('src') ?? '').trim();
  // Still on the markup src → loader idle. A currentSrc that matches neither
  // (srcset pick, CDN rewrite of the real file) is a real choice — keep it.
  if (src && addressRefersTo(live, src)) return true;
  return false;
}

/**
 * Whether a live absolute `currentSrc` is the same resource as a (possibly
 * relative) attribute value. `currentSrc` is usually absolute; attributes are
 * often not. Equality or a trailing-path match is enough: we only need to tell
 * "still the placeholder file" from "already the real file".
 */
function addressRefersTo(live: string, attr: string): boolean {
  if (!attr) return false;
  if (live === attr) return true;
  // Strip a trailing slash so /photo and /photo/ do not disagree for free.
  const a = attr.replace(/\/$/, '');
  const l = live.replace(/\/$/, '');
  if (l === a) return true;
  if (l.endsWith(a) && (l.length === a.length || l[l.length - a.length - 1] === '/')) {
    return true;
  }
  return false;
}

/** `currentSrc` off a live image, or `''` where the environment has none. */
function readLiveCurrentSrc(img: Element): string {
  // Not `img.getAttribute`: currentSrc is a layout property, not markup.
  // Under linkedom / happy-dom it is `undefined`; under Chrome it is the file
  // the reader is actually looking at.
  const value = (img as HTMLImageElement).currentSrc;
  return typeof value === 'string' ? value : '';
}

/**
 * Walks a live root and records each image's `currentSrc`, keyed by
 * `imageAddressSignature`.
 *
 * Ordering constraint the consumer is under: call this while the page is live
 * and untouched, **before** `selectionToCapture` / `highlightsToMd`. Reading
 * costs no mutation — no attribute is written, so the style snapshot that the
 * capture takes next still answers from a clean cache. Building the map *after*
 * the snapshot has started, or by marking the live nodes, is exactly the class
 * of DOM write `capture.ts` exists to forbid.
 *
 * Why not a document-order zip taken before cloning: `dropOwnUI` removes
 * own-UI and everything in `exclude` from the clone, and a reading mode
 * excludes exactly the furniture that is full of images — so the clone holds
 * fewer `<img>` than the live root and every image after the first excluded
 * one would get somebody else's address. Silently. The signature is what
 * survives that drop.
 *
 * `bun test` cannot prove that the *values* are the browser's real
 * `currentSrc`: under linkedom and happy-dom the property is `undefined`, so
 * the map this returns in the suite has empty strings and
 * `materializeCurrentSrc` leaves those images alone. What the suite can prove
 * is the keying — that the signature is the single spelling both halves use,
 * and that a clone missing some of the live images still finds the right
 * entry for the ones that remain. Chrome is the last word on the values.
 */
export function collectCurrentSrc(root: ParentNode): Map<string, string> {
  const map = new Map<string, string>();
  for (const img of Array.from(root.querySelectorAll('img'))) {
    const key = imageAddressSignature(img);
    // First write wins; a later image with the same signature is the same
    // address set and therefore the same currentSrc by construction.
    if (!map.has(key)) map.set(key, readLiveCurrentSrc(img));
  }
  return map;
}

/**
 * Writes a live image's `currentSrc` into the clone's `src`, and strips every
 * attribute that would otherwise win over it in the converter.
 *
 * Promise: the **picture the document should hold**, not the pixels currently
 * painted. `currentSrc` is a layout answer and often the right file — a
 * resolved srcset pick, a lazy load that has fired — but when the loader has
 * not run it is still the placeholder in `src`. Carrying that over and
 * stripping `data-src` is how a grey square reached the Markdown while the
 * converter alone would have kept `real-photo.jpg`. A placeholder verdict or a
 * still-pending lazy attribute leaves the element alone so `extractImageUrl`
 * can prefer the real address.
 *
 * `currentSrc` exists only on a live, laid-out `<img>`. A detached clone has
 * no layout, so `(cloneImg as HTMLImageElement).currentSrc` is not the
 * browser's choice — under linkedom it is not even defined. The value has to
 * be read from the live page *before* the capture, and handed in here.
 *
 * Two forms of the hand-off:
 *
 * - a `Map` from `collectCurrentSrc` (or any map keyed by
 *   `imageAddressSignature` — that name is the single spelling both halves
 *   use); preferred, because it survives `dropOwnUI` / `exclude` without a
 *   document-order zip;
 * - a callback `(cloneImg) => string | null | undefined` for a consumer that
 *   already has its own pairing.
 *
 * Either way, a missing, empty, placeholder, or still-pending lazy value
 * leaves that image alone. `bun test` cannot prove a real `currentSrc` — see
 * `collectCurrentSrc`.
 */
export function materializeCurrentSrc(
  fragment: ParentNode,
  liveCurrentSrcOf:
    | ((cloneImg: Element) => string | null | undefined)
    | ReadonlyMap<string, string>,
): void {
  const resolve: (img: Element) => string | null | undefined =
    typeof liveCurrentSrcOf === 'function'
      ? liveCurrentSrcOf
      : (img) => liveCurrentSrcOf.get(imageAddressSignature(img));

  for (const img of Array.from(fragment.querySelectorAll('img'))) {
    const live = resolve(img);
    if (live == null || !isUsableCurrentSrc(live)) continue;
    const value = live.trim();
    if (lazyLoaderStillPending(img, value)) continue;
    img.setAttribute('src', value);
    for (const name of IMAGE_ADDRESS_ATTRS) {
      img.removeAttribute(name);
    }
  }
}

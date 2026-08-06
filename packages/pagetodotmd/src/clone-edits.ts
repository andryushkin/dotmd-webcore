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
 * Whether a live `currentSrc` is worth carrying onto the clone.
 *
 * Empty and whitespace-only are not addresses. A `data:image/…` URI is the
 * 1×1 tracker pixel / loading placeholder a page leaves in `src` while the real
 * file is still resolving — writing that into `src` and stripping the lazy-load
 * attributes would replace a missing image (and its alt text) with a fake one.
 * `bun test` cannot settle this path: under linkedom and happy-dom
 * `img.currentSrc` is `undefined`, so the behaviour is verified in a real
 * Chrome, not here.
 */
function isUsableCurrentSrc(src: string): boolean {
  const value = src.trim();
  if (!value) return false;
  if (value.startsWith('data:image/')) return false;
  if (value.length < 50 && value.startsWith('data:')) return false;
  return true;
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
 * `currentSrc` is a layout answer: it exists only on a live, laid-out `<img>`.
 * A detached clone has no layout, so `(cloneImg as HTMLImageElement).currentSrc`
 * is not the browser's choice — under linkedom it is not even defined. The
 * value therefore has to be read from the live page *before* the capture, and
 * handed in here.
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
 * Either way, a missing, empty, or placeholder value leaves that image alone.
 * `bun test` cannot prove a real `currentSrc` — see `collectCurrentSrc`.
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
    img.setAttribute('src', live.trim());
    for (const name of IMAGE_ADDRESS_ATTRS) {
      img.removeAttribute(name);
    }
  }
}

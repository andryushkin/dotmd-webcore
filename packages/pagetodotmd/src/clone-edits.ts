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
 * Every attribute `extractImageUrl` in `htmltodotmd` reads as an address, in the
 * order it prefers them.
 *
 * PAIR with `packages/htmltodotmd/src/rules/inline.ts` → `extractImageUrl`.
 * Writing `src` alone changes nothing: that function reads `data-src` and
 * friends first, then `srcset` (picking the largest descriptor), and only then
 * `src`. If a future edit teaches it a new source of an address, this list must
 * gain the same name or the reader silently gets the largest `srcset` variant
 * again. Never "every `data-*`": pages keep meaningful content under that
 * prefix, and stripping those is not this function's job.
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

/**
 * Writes a live image's `currentSrc` into the clone's `src`, and strips every
 * attribute that would otherwise win over it in the converter.
 *
 * `currentSrc` is a layout answer: it exists only on a live, laid-out `<img>`.
 * A detached clone has no layout, so `(cloneImg as HTMLImageElement).currentSrc`
 * is not the browser's choice — under linkedom it is not even defined. The
 * value therefore has to be read from the live page *before* (or while) the
 * clone is made, and handed in here. `liveCurrentSrcOf` is that hand-off: for
 * each `<img>` in the fragment, in document order, the consumer returns the
 * live node's `currentSrc` (or `null`/`undefined`/empty to leave that image
 * alone). How the consumer pairs clone to live — by document-order zip against
 * a list taken before cloning, by a map keyed on a stable attribute, anything
 * else — is its own; this signature only refuses to invent the pairing itself.
 */
export function materializeCurrentSrc(
  fragment: ParentNode,
  liveCurrentSrcOf: (cloneImg: Element) => string | null | undefined,
): void {
  for (const img of Array.from(fragment.querySelectorAll('img'))) {
    const live = liveCurrentSrcOf(img);
    if (live == null || !isUsableCurrentSrc(live)) continue;
    img.setAttribute('src', live.trim());
    for (const name of IMAGE_ADDRESS_ATTRS) {
      img.removeAttribute(name);
    }
  }
}

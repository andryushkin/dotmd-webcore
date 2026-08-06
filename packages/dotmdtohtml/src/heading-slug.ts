/**
 * The base `id` a heading would carry, from its text alone.
 *
 * A second package reads a live page's internal links and hands back the
 * heading *text* of each target — deliberately no slug, because it must not
 * depend on this package. The consumer joins the two by running that text
 * through this function and getting the same id this renderer printed. That
 * only works if the function is pure: same text, same id, no renderer, no
 * options, no state.
 *
 * The uniquifying suffix for a repeated heading is *not* part of this. Two
 * headings titled "Intro" in one document cannot be told apart from the text
 * alone; the document is what decides, and the list on `RenderResult` is where
 * a consumer learns the final id. Call this for the base; read the list for
 * the id that was actually written.
 *
 * Decisions, pinned so a consumer and this renderer stay on the same side of
 * each one:
 *
 * - **Empty text** → `""`. The renderer turns that into the base `heading`
 *   before uniquifying; the empty string is still what a pure function of no
 *   text has to return.
 * - **Punctuation-only or emoji-only** → `""`, same reason: nothing left once
 *   non-letters are gone is not a slug invented here.
 * - **Non-Latin letters stay.** Cyrillic and CJK are letters (`\p{L}`); they
 *   are lowercased where the script has case and otherwise kept. Stripping
 *   them to empty is the defect a Russian document hits first.
 * - **Everything else becomes a hyphen**, then runs of hyphens collapse and
 *   leading/trailing ones fall off. Spaces, punctuation, symbols — one rule.
 */

/**
 * Base id for a heading with this text. Pure. No uniqueness suffix — that is
 * the document's job, not this function's.
 */
export function headingSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    // Letters (any script), marks, numbers and underscore survive; everything
    // else is a separator. Underscore is kept because it is already an id
    // character and turning `foo_bar` into `foo-bar` would invent a difference
    // between the text and the anchor for no gain.
    .replace(/[^\p{L}\p{M}\p{N}_]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

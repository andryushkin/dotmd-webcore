/**
 * The snapshot protocol: what a holder of live nodes writes down, and what this
 * library reads back off a detached clone.
 *
 * The engine converts markup and has no layout engine — `getComputedStyle` is
 * not available to it, and a class or a stylesheet is invisible from a clone. So
 * the side that *does* have live nodes records the answers as attributes before
 * cloning, and this library reads them. That is a protocol between two packages,
 * and a protocol has to have one spelling: the names of the attributes, the
 * thresholds, and the verdicts that turn a declaration into a decision are
 * declared here once and imported by both sides.
 *
 * A subpath of its own rather than part of the main entry, for the reason
 * `./fallback-tags` and `./mathml` are: a caller that only converts markup needs
 * none of it, and the main entry is what that caller pays for. The other side —
 * `pagetodotmd` — needs all of it and none of the converter's own surface.
 *
 * Everything re-exported here was already reachable by a deep import into
 * `src/utils/inline-style.ts`, which is how the clipper reached it before this
 * entry existed. A deep import is not a contract: it survives only while the
 * file keeps its path, and it made every internal rename a silent break in
 * another repository's working copy. What is listed below is the contract, and
 * nothing outside this file may be imported across the package boundary.
 */

export {
  // The attribute names. Both sides write and read exactly these, and a second
  // spelling on either side is a defect nothing fails on: `ROW_ATTR` was once
  // written out again in the content script under a comment saying the two could
  // not disagree, and the value crossed the boundary while the name did not.
  SNAPSHOT_ATTR,
  ROW_ATTR,
  ONE_LINE_MARK,
  // The thresholds. The fidelity oracle imports them for the same reason the
  // snapshot does — a second number is a second answer, and the oracle would go
  // on measuring the old one after this side moved.
  BOLD_THRESHOLD,
  BOLD_WEIGHT,
  NORMAL_WEIGHT,
  // The property sets a snapshot has to record, each named by what it decides.
  CLIPPED_PROPERTIES,
  HIDING_PROPERTIES,
  REVEAL_PROPERTIES,
  LINE_ITEM_TAGS,
  // The readers: one question, asked of a computed style on the live side and of
  // the recorded attribute here. Both sides must answer the same, which is what
  // makes them one implementation rather than two.
  alignFrom,
  displayFrom,
  invisibleFrom,
  italicFrom,
  removedFrom,
  revealsFrom,
  sizeFrom,
  struckFrom,
  visuallyHiddenFrom,
  weightFrom,
  paintedBackground,
  isMonospaced,
  // What a tag already implies, so a snapshot can stay silent about it. Silence
  // is most of what keeps the recorded markup smaller than the page.
  isBlockTag,
  isBoldTag,
  isItalicTag,
  isStruckTag,
  // The element's own `style` attribute, read through the same parser as the
  // snapshot so neither side can invent a private spelling.
  inlineStyle,
  type StyleReader,
} from './utils/inline-style.js';

/**
 * The tag half of the whitespace model.
 *
 * A `\n` in a text node draws a line only where the computed `white-space`
 * preserves it, and the live side reads that from the browser — but the tag
 * defaults are this library's, spelled in its sanitizer. Asked rather than
 * restated: a tag added there and not on the other side is a hard break drawn
 * twice, and nothing fails until a reader sees it.
 *
 * A predicate rather than the set, so a caller cannot edit the model mid-run.
 */
export { preservesSourceWhitespace } from './core/sanitizer.js';

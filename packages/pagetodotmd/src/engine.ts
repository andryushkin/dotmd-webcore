/**
 * The only place this package reaches into the converter, and the only place
 * that has to know how it is spelled.
 *
 * Two packages in one repository, and two ways to read the second one: from
 * source, which is what every consumer here does — the extensions vendor this
 * repository as a submodule, `bun build` inlines the TypeScript and no
 * `node_modules` is involved — and from a published tarball, where
 * `htmltodotmd` is an ordinary dependency resolved by name.
 *
 * Those are the same graph, not two, and this file is what keeps them one: the
 * imports below are relative source paths, and `tsup.config.ts` turns exactly
 * these three into the package's public subpaths when it builds for
 * publication. Nothing else in this package may import across the boundary, so
 * there is one list, in one file, and the build derives from it rather than
 * restating it.
 *
 * All three targets are public entry points of `htmltodotmd`. A deep import into
 * `src/utils/inline-style.ts` — which is how the clipper reached these names
 * before this package existed — is not a contract: it holds only while the file
 * keeps its path, and it made every rename inside the converter a break nothing
 * could see coming.
 */

// Named one at a time and never `export *`. Two reasons, and the second is why
// it is worth the list: a bundler cannot see through a star re-export of an
// external module, so the generated types came out guessing which of the two
// entries a name came from; and a list is what a boundary *is* — it fails loudly
// in both directions, at `bunx tsc`, when the other side adds or drops a name.

// → `htmltodotmd/snapshot`: the protocol between a holder of live nodes and a
// converter that has none. Names of attributes, thresholds, and the readers both
// sides must answer identically.
export {
  SNAPSHOT_ATTR,
  ROW_ATTR,
  ONE_LINE_MARK,
  BOLD_THRESHOLD,
  BOLD_WEIGHT,
  NORMAL_WEIGHT,
  CLIPPED_PROPERTIES,
  HIDING_PROPERTIES,
  REVEAL_PROPERTIES,
  LINE_ITEM_TAGS,
  alignFrom,
  contentSkippedFrom,
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
  isBlockTag,
  isBoldTag,
  isItalicTag,
  isStruckTag,
  inlineStyle,
  preservesSourceWhitespace,
} from '../../htmltodotmd/src/snapshot.js';
export type { StyleReader } from '../../htmltodotmd/src/snapshot.js';

// → `htmltodotmd/selection`: what a `Range` needs before it can be converted.
export {
  enrichRange,
  headingOffsetAcross,
  topHeadingLevelAcross,
  offsetForTop,
  selectionToMarkdown,
  DEFAULT_PAGE_MARKS,
} from '../../htmltodotmd/src/selection.js';
export type { PageMarks } from '../../htmltodotmd/src/selection.js';

// → `htmltodotmd`: the converter itself. Only `toMarkdown` and the option type —
// the main entry resolves to a different build per environment, and this is the
// part every one of them has.
export { toMarkdown } from '../../htmltodotmd/src/browser.js';
export type { MarkItDownOptions, Rule } from '../../htmltodotmd/src/browser.js';

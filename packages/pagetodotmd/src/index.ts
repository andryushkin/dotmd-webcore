/**
 * Reading a live page: the whole of what needs a browser and a layout engine.
 *
 * `htmltodotmd` converts markup and can do it anywhere — a tab, a server, a
 * test with no DOM at all. What it cannot do is *look*: a class, a stylesheet,
 * a shadow tree, the number of lines a row was drawn on, whether a newline in
 * the source became a line on screen. Those answers exist only while somebody
 * holds live nodes, and only for a moment. This package is that moment.
 *
 * What it produces is the same thing the converter takes — an enriched fragment,
 * or the Markdown it converts to — so a product built on the two of them does
 * not have to know that the page was ever read separately.
 */
export {
  captureNamespace,
  canonicalize,
  registerOwnUI,
  DEFAULT_NAMESPACE,
  DEFAULT_PREFIX,
  type CaptureNamespace,
} from './namespace.js';

export {
  captureStyles,
  cloneRangeWithBr,
  expandRangeToWords,
  highlightsToMd,
  selectionToCapture,
  selectionToMd,
  type Capture,
  type CaptureOptions,
} from './capture.js';

export {
  computedStyleIn,
  contentRectsIn,
  snapshotScope,
  snapshotScopeOf,
  snapshotStyles,
  NOTHING_MEASURED,
  type ComputedStyleOf,
  type ContentRectsOf,
  type DrawnRect,
  type SnapshotOptions,
} from './style-snapshot.js';

export {
  breakPreservedNewlines,
  collapseHardBreaksToParagraphs,
  elementsPreservingNewlines,
  markPreservedNewlines,
  preservesNewlines,
  rangePreservesNewlines,
} from './hard-breaks.js';

export {
  hasCapturableSelection,
  mirrorShadowRoots,
  openShadowRoots,
  selectionRanges,
  shadowHostOf,
  styleScopeOf,
  type BoundaryPoints,
  type CapturableSelection,
} from './shadow-selection.js';

export { joinFragments } from './join-fragments.js';

// Optional clone edits and the hook context they are typically called from.
// Mechanism only — this package never applies them; the consumer's policy does.
export {
  IMAGE_ADDRESS_ATTRS,
  collectCurrentSrc,
  imageAddressSignature,
  materializeCurrentSrc,
  openDetails,
} from './clone-edits.js';
export type { PrepareCloneContext } from './capture.js';

// Which part of a live page is the article, and the fragment targets that
// outlive the round trip. Free functions a consumer calls before a capture —
// neither is a side effect of one.
export {
  findArticle,
  visibleTextLength,
  DEFAULT_MIN_TEXT_LENGTH,
  type ArticleFound,
  type ArticleMetrics,
  type ArticleRefusal,
  type ArticleRefused,
  type ArticleResult,
  type FindArticleOptions,
} from './extract.js';

export {
  collectFragmentIds,
  type CollectFragmentIdsOptions,
  type FragmentTarget,
} from './fragment-ids.js';

// What a reader was shown, asked of a live layout engine — `findArticle`'s own
// default, exported because a consumer that scores anything else on a page
// should ask the same question the same way rather than write a second answer.
export { isElementVisible } from './visibility.js';

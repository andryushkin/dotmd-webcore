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

// --- article extraction (stage2) — keep this block at the end of the file ---
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

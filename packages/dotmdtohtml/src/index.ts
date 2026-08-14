/**
 * Markdown back to HTML, in the dialect `htmltodotmd` writes.
 *
 * The converter turns a page into a file; something has to turn that file back
 * into a document a person can look at, and "run it through a Markdown renderer"
 * is not enough. The file may hold `==highlight==`, which no standard defines;
 * blank lines the page left, which every renderer collapses; LaTeX, which has to
 * reach a typesetter without ever passing through the markup; and a product's own
 * blocks. Getting any of that wrong shows a reader something other than what they
 * saved, in the one place they check.
 *
 * That is why this is a package and not a screen's worth of code in a panel: the
 * clipper renders a preview, and whatever reads these files next has to render
 * the same dialect the same way, or the two products disagree about a file both
 * of them wrote.
 *
 * Nothing here is imported: `marked`, DOMPurify and KaTeX arrive as arguments,
 * so this package has no runtime dependencies and cannot force a second copy of
 * anybody's parser into a consumer's bundle.
 */
export { MARKED_PROFILE } from './profile.js';

export {
  createMarkdownRenderer,
  type MarkdownContribution,
  type MarkdownRenderer,
  type RenderedHeading,
  type RenderResult,
  type RendererOptions,
} from './renderer.js';

// Pure: heading text → base id. The uniquifying suffix is not part of this —
// that needs the document, and lives on `RenderResult.headings`.
export { headingSlug } from './heading-slug.js';

// The repair for the ids a sanitizer took off a mounted document. Deliberately
// not inside `mount()`: the sanitizer is the consumer's, and putting an
// attribute back is overruling it.
export { reassertHeadingIds } from './heading-ids.js';

// The links of a rendered note: the join from the live page's fragment ids to
// the ids this package printed, and the markup that keeps a click out of
// whatever is showing the note. Behaviour arrives as a callback; nothing here
// navigates.
export {
  buildHeadingFragmentMap,
  findById,
  wireDocumentLinks,
  type HeadingFragmentTarget,
  type WireDocumentLinksOptions,
} from './links.js';

export {
  hydrateMath,
  type MathEntry,
  type MathPlaceholders,
} from './maths.js';

export {
  renderMath,
  type KatexEngine,
  type MarkedConstructor,
  type MarkedInstance,
  type MarkedOptions,
  type Sanitize,
} from './engines.js';

// The dialect's one non-standard marker, on its own: a caller that parses this
// Markdown without rendering a document needs the extension and must not write a
// second copy of it.
export { markedHighlight } from './highlight.js';

// What a stylesheet is allowed to select on, and which stylesheets there are.
// The CSS itself is files under `dotmdtohtml/base.css` and
// `dotmdtohtml/themes/*.css`; this is the part a program needs.
export {
  DOTMD_CLASS,
  DOTMD_COLOR_SCHEME_ATTR,
  DOTMD_SCHEMA_ATTR,
  DOTMD_SCHEMA_VERSION,
  DOTMD_TOKENS,
} from './schema.js';

export {
  DOTMD_BASE_STYLESHEET,
  DOTMD_STYLESHEET_SPECIFIER_PREFIX,
  DOTMD_THEMES,
  type DotmdTheme,
} from './themes.js';

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
  type RenderResult,
  type RendererOptions,
} from './renderer.js';

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

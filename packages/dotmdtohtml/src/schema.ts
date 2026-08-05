/**
 * The names a stylesheet is allowed to select on, and the version they carry.
 *
 * A theme is CSS written against markup somebody else emits, which only works if
 * the markup is a declared thing. Most of it needs no declaring — a heading is an
 * `<h2>`, a quotation a `<blockquote>`, a highlight a `<mark>` — and a class
 * beside a native element is a second name for something that already has one.
 * So there is a class here only where the element cannot say what it is:
 *
 * - a formula is a `<span>`, because a `<div>` would open an HTML block and
 *   swallow the paragraph around it, and nothing in a span says it is display
 *   maths that has to become a block again;
 * - a run of blank lines the page left is a `<div>` with no content at all, and
 *   without a height it is worth nothing;
 * - a task item is an `<li>` whose first child is a checkbox, which is a
 *   structural query (`:has()`) rather than a name — and it was one, in a
 *   product's stylesheet, where nothing said it was load-bearing;
 * - the document root, because a theme has to have something to scope itself to,
 *   and it must not be the product's scrolling shell.
 *
 * The version is on the root as an attribute. It is not decoration: a theme is a
 * file, a file outlives the renderer that shipped with it, and a stylesheet
 * written against version 1 that finds itself in front of version 2 markup can at
 * least say so. Adding a class is not a version change; removing or re-meaning
 * one is.
 */

/**
 * The DOM schema this renderer writes. Bumped when a name stops meaning what it
 * meant, never when one is added.
 */
export const DOTMD_SCHEMA_VERSION = 1;

/** Where the version is written: on the document root, by `mount()`. */
export const DOTMD_SCHEMA_ATTR = 'data-dotmd-schema';

/**
 * The attribute a product sets to force one of a theme's two palettes, rather
 * than letting `prefers-color-scheme` decide. Read by themes on the root or on
 * any ancestor of it; the package itself never writes it.
 */
export const DOTMD_COLOR_SCHEME_ATTR = 'data-dotmd-color-scheme';

/** Every class this renderer writes, and nothing else may be selected on. */
export const DOTMD_CLASS = {
  /** The document root — the element `mount()` writes into. Never the host. */
  root: 'dotmd-doc',
  /** Any formula, drawn or not. */
  math: 'dotmd-math',
  /** A formula that stood on its own and has to be a block again. */
  mathDisplay: 'dotmd-math--display',
  /** A formula inside a line of prose. */
  mathInline: 'dotmd-math--inline',
  /** The blank lines a page left, which have a height and no content. */
  contentGap: 'dotmd-content-gap',
  /** A list item whose marker is a checkbox. */
  task: 'dotmd-task',
  /** …and whose checkbox is ticked. */
  taskDone: 'dotmd-task--done',
} as const;

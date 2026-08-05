/**
 * The stylesheets this package ships, named once.
 *
 * A manifest rather than the stylesheets themselves: CSS is files, exported under
 * subpaths, so a product links them, bundles them or copies them into a package
 * the way it already does with everything else it ships — and a build step that
 * has to reach inside a JavaScript module to get at a rule is a build step nobody
 * wants. What TypeScript is good for is the list: which themes exist, what a
 * consumer would import to get one, and the fact that the base sheet is not
 * optional.
 *
 * Choosing between them is a product's business — a setting, a stored preference,
 * a link element swapped at runtime — and none of that is here. What is here is
 * the answer to "what may be chosen from".
 */

/** One theme: an id a product may store, and the specifier that loads it. */
export interface DotmdTheme {
  /** Stable across releases; this is what a product writes into its settings. */
  readonly id: string;
  /** What a bundler or an import map resolves to the stylesheet. */
  readonly stylesheet: string;
}

/**
 * Not a theme and not optional.
 *
 * It carries the rules a document is *wrong* without rather than merely plain: a
 * display formula that is not a block, blank lines the page left with no height,
 * a task item wearing a bullet beside its checkbox. Each of those was a rule in a
 * product's own stylesheet, where nothing said that the renderer depended on it —
 * and each was one deletion away from changing the document silently. A theme is
 * loaded after this and adds to it; a theme that replaced it would have to
 * restate all three, which is the arrangement that already failed.
 */
export const DOTMD_BASE_STYLESHEET = 'dotmdtohtml/base.css';

/**
 * Every theme, in the order a chooser should offer them.
 *
 * `reader` is the document the clipper's panel has always drawn; `paper` exists
 * because one theme proves nothing — a contract with a single implementation is
 * indistinguishable from the implementation.
 */
export const DOTMD_THEMES: readonly DotmdTheme[] = [
  { id: 'reader', stylesheet: 'dotmdtohtml/themes/reader.css' },
  { id: 'paper', stylesheet: 'dotmdtohtml/themes/paper.css' },
];

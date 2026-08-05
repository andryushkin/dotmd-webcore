/**
 * The three libraries this package refuses to depend on, described rather than
 * imported.
 *
 * A renderer needs a Markdown parser, a sanitizer and a maths typesetter, and
 * every consumer already has all three: an extension vendors them under a
 * content security policy that decides what may be loaded, a test wants a
 * sanitizer that does nothing so it can see the markup, a server-side reader has
 * its own copies. Bundling a second `marked` into this package would ship two
 * parsers to a product that only ever wanted one, and — with `marked` in
 * particular — a second one that must stay the exact version the converter's
 * tests render with.
 *
 * So they arrive as arguments, the way `createMathMLFallbackRule(convert)` in
 * the converter takes its converter. The types below are the shapes this package
 * uses and nothing more; they are deliberately not a model of anybody's API.
 *
 * The one thing that is *not* handed over is how the typesetter is called.
 * `katexOptions` is fixed here — see `renderMath()` — because those four options
 * are the difference between a formula that fails softly and a note that can
 * draw HTML through it, and a consumer passing a "compatible" function is a
 * consumer that can get them wrong.
 */

/** How the parser is configured. One profile for every caller — see `MARKED_PROFILE`. */
export interface MarkedOptions {
  readonly breaks: boolean;
  readonly gfm: boolean;
  readonly html: boolean;
  readonly async?: false;
}

/**
 * `marked`, as this package uses it.
 *
 * `lexer` and `parser` are named apart from `parse` on purpose: the content gaps
 * go in between the two, and a token stream is the only place a blank line can be
 * told from a blank line inside a code fence.
 */
export interface MarkedInstance {
  use(extension: { extensions: readonly unknown[] }): unknown;
  lexer(src: string): unknown[];
  parser(tokens: unknown[]): string;
  parse(src: string, options?: { async: false }): string;
}

/** The class, not an instance: a renderer builds one parser of its own. */
export type MarkedConstructor = new (options: MarkedOptions) => MarkedInstance;

/** Everything on its way to `innerHTML` goes through this. DOMPurify, in a browser. */
export type Sanitize = (html: string) => string;

/** KaTeX. The options are this package's; a consumer hands over the library. */
export interface KatexEngine {
  renderToString(
    latex: string,
    options: {
      displayMode: boolean;
      throwOnError: boolean;
      output: string;
      trust: boolean;
    },
  ): string;
}

/**
 * A formula drawn, or an exception.
 *
 * `throwOnError: false` makes KaTeX draw what it could not parse in red rather
 * than throw, which is the behaviour wanted almost everywhere; `output: 'html'`
 * keeps the MathML twin out of the DOM, where it doubles the text a reader
 * copies out of the preview; `trust: false` is what stops `\href` and `\url` in a
 * captured formula becoming a live link. The first two were the panel's; the
 * third was KaTeX's default, which is not the same as a decision.
 */
export function renderMath(katex: KatexEngine, latex: string, display: boolean): string {
  return katex.renderToString(latex, {
    displayMode: display,
    throwOnError: false,
    output: 'html',
    trust: false,
  });
}

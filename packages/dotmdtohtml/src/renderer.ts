/**
 * Markdown to a document, in two steps a caller cannot get out of order.
 *
 * `render()` parses and sanitizes and hands back markup with the formulas held
 * back; `mount()` writes that markup into an element and draws the formulas into
 * it. The sanitizer is inside the first step rather than left to the caller for
 * the same reason the capture's ordering lives in `pagetodotmd`: the order is the
 * package's business, and a consumer assembling it themselves is a consumer who
 * can leave a step out — this one having "sanitize before `innerHTML`" in it.
 *
 * `render()` is synchronous, and that is a contract rather than an implementation
 * detail. An editor renders a preview on every keystroke; an asynchronous parser
 * gives a race in which a render started earlier finishes later and overwrites
 * the newer text with the older document.
 */
import { contentGapExtension, markContentGaps, type BlockToken } from './content-gaps.js';
import { collectHeadings, type RenderedHeading } from './heading-ids.js';
import { markedHighlight } from './highlight.js';
import {
  beginMathRun,
  hydrateMath,
  mathBlockExtension,
  mathExtension,
  type MathPlaceholders,
  type MathRun,
} from './maths.js';
import { renderMath, type KatexEngine, type MarkedConstructor, type Sanitize } from './engines.js';
import { MARKED_PROFILE } from './profile.js';
import { DOTMD_CLASS, DOTMD_SCHEMA_ATTR, DOTMD_SCHEMA_VERSION } from './schema.js';

export type { RenderedHeading } from './heading-ids.js';

/**
 * A block a product puts into the note and wants shown as something else.
 *
 * Not `(md: string) => string`. A free preprocessor is a second parser nobody
 * declared: it can rewrite anything, in any order, including text inside a code
 * fence — which is exactly how the maths pass this package replaced lost the
 * contents of shell listings. A contribution instead states *when* it runs, *what
 * range of the note it consumes*, and what stands in that range's place; the
 * package does the replacing and puts the result through the sanitizer with the
 * rest of the document, so contributed markup is no more trusted than the note's.
 *
 * The clipper's front matter is the case this exists for: `buildMetadata()`
 * writes the block and `METADATA_RE` reads it back, the two are halves of one
 * agreement, and both stay in the product that decided how a note records where
 * it came from. This package has no opinion about front matter and would have to
 * grow one to hold either half.
 */
export interface MarkdownContribution {
  /** For a person reading a stack trace, and for a duplicate to be visible. */
  readonly name: string;
  /**
   * The only stage there is today. Named anyway: a contribution that runs on the
   * token stream is a different thing with different powers, and a caller should
   * have said which it wrote before this package has to guess.
   */
  readonly stage: 'before-parse';
  /**
   * The range of the note this contribution takes over. Global — the block is not
   * necessarily at the top of the file: a second capture is appended to a note
   * that already has one, so the third block is in the middle of the text.
   */
  readonly consumes: RegExp;
  /** The markup that stands in the consumed range's place. */
  render(match: RegExpMatchArray): string;
}

/** Markup on its way into a document, and the formulas that go in after it. */
export interface RenderResult {
  /** Sanitized, and never anything else: `render()` does not hand out raw markup. */
  readonly html: string;
  /**
   * This render's formulas, owned by this result. A second render does not empty
   * them — the panel used to keep one module-wide map, and a reader who rendered
   * twice before mounting once hydrated the second document's formulas into the
   * first one's placeholders.
   */
  readonly math: MathPlaceholders;
  /**
   * This render's headings, when `headingIds` is on — level, plain text, and the
   * `id` each tag received, in document order. Empty when the option is off, so a
   * caller that never asked for anchors is not handed a list that pretends to
   * match markup with none. Owned by this result the same way `math` is: a second
   * render of the same note mints the same ids again rather than continuing a
   * counter the first render left behind.
   */
  readonly headings: readonly RenderedHeading[];
}

export interface RendererOptions {
  /** The `Marked` class. A renderer builds one parser of its own from it. */
  Marked: MarkedConstructor;
  /** DOMPurify, in a browser. Runs inside `render()`, on everything. */
  sanitize: Sanitize;
  /** KaTeX. How it is called is this package's decision — see `engines.ts`. */
  katex: KatexEngine;
  /** Product blocks, applied in the order given. */
  contributions?: readonly MarkdownContribution[];
  /**
   * When on, every heading `h1`…`h6` is written with an `id`, and
   * `RenderResult.headings` lists them. Off by default: the clipper's preview
   * panel renders through this package, and ids on its headings would change the
   * panel's DOM and its `:target` behaviour by a decision nobody made there.
   *
   * The ids are put on by the heading renderer, *before* `options.sanitize` runs.
   * Default DOMPurify keeps `id`; a consumer that configures the sanitizer to
   * strip it will get a list naming anchors the markup no longer holds — which is
   * worse than no list. Allow `id` through, or leave the option off.
   */
  headingIds?: boolean;
}

export interface MarkdownRenderer {
  /** Markdown in, sanitized markup and the formulas of that render out. */
  render(md: string): RenderResult;
  /** That markup into an element, then the formulas into the markup. */
  mount(container: Element, result: RenderResult): void;
  /** Both, for the caller who has nothing to do in between. */
  renderInto(container: Element, md: string): RenderResult;
}

/**
 * Hands the consumed range to the contribution and keeps the rest of the note.
 *
 * `matchAll` rather than `String.replace`, for two reasons: it insists on the
 * global flag, which is what the contract asks for, and it hands the contribution
 * the whole match — index, groups and all — instead of the argument list
 * `replace` invents, where the groups, the offset and the subject run together.
 *
 * It differs from `replace` in one way that matters, and the copy is what settles
 * it: `matchAll` begins at the expression's own `lastIndex`, while `replace`
 * resets it. A global expression carries `lastIndex` from wherever it was last
 * used, so a caller who asked `consumes.test(md)` anywhere — a perfectly ordinary
 * thing to do with a regular expression one owns — would leave this scan starting
 * in the middle of the note, and every block above that point would be dropped in
 * silence. The scan gets an expression of its own, at zero.
 */
function contribute(md: string, contribution: MarkdownContribution): string {
  const consumes = new RegExp(contribution.consumes.source, contribution.consumes.flags);
  let out = '';
  let at = 0;
  for (const match of md.matchAll(consumes)) {
    const start = match.index;
    out += md.slice(at, start) + contribution.render(match);
    at = start + match[0].length;
  }
  return out + md.slice(at);
}

/**
 * A renderer, with its own parser.
 *
 * The parser is built once and never `use()`d again: `marked` accumulates
 * registrations, so a `use()` per render grows the extension list without bound.
 * It is also this renderer's own instance rather than the module-wide `marked`
 * every consumer already has — the maths extensions carry the formulas of a
 * single render, and registering those on the shared object would put them in
 * front of every other caller of it. That was not hypothetical: the panel
 * configured the shared `marked` for its preview and a second caller in the same
 * bundle — the plain-text hand-off — worked only because that configuration had
 * happened to run first.
 */
export function createMarkdownRenderer(options: RendererOptions): MarkdownRenderer {
  const contributions = options.contributions ?? [];
  const headingIds = options.headingIds === true;
  // The render that is open. `marked` calls a tokenizer during `lexer()` and a
  // renderer during `parser()`, both inside the synchronous call below, so this
  // is never non-null across a suspension point — there is none.
  let open: MathRun | null = null;
  const current = (): MathRun => {
    if (!open) throw new Error('dotmdtohtml: the parser was reached outside render()');
    return open;
  };

  // Headings of the render that is open, consumed in document order by the
  // heading renderer. Same save/restore rule as `open`: a nested render (nothing
  // does this today) must not leave the outer parse reading the inner list.
  let openHeadings: readonly RenderedHeading[] = [];
  let headingAt = 0;

  const rendererOverrides: Record<string, unknown> = {
    /**
     * A task item, said out loud.
     *
     * `marked` writes the checkbox and leaves the `<li>` bare, so the only way
     * to find one is to ask whether it has a checkbox in it — and that is what
     * a product's stylesheet was doing, with `:has()`, where nothing said the
     * renderer depended on it. A structural query is not a name: it cannot be
     * versioned, it cannot be documented in a schema, and a theme written
     * against it is a theme that has guessed. The checkbox stays where it is;
     * this only lets a stylesheet say which item it belongs to.
     */
    listitem(text: string, task: boolean, checked: boolean): string {
      if (!task) return `<li>${text}</li>\n`;
      const done = checked ? ` ${DOTMD_CLASS.taskDone}` : '';
      return `<li class="${DOTMD_CLASS.task}${done}">${text}</li>\n`;
    },
  };

  // Registered only when the option is on, so the default path never overrides
  // `marked`'s own heading renderer — byte-for-byte the markup it produced
  // before this option existed.
  if (headingIds) {
    rendererOverrides.heading = (text: string, level: number): string => {
      const heading = openHeadings[headingAt++];
      // collectHeadings walks the same tree `parser` does; a missing entry would
      // mean those two disagreed about what a heading is, and an id-less tag next
      // to a list that claims one is worse than no list.
      if (!heading) return `<h${level}>${text}</h${level}>\n`;
      return `<h${level} id="${heading.id}">${text}</h${level}>\n`;
    };
  }

  const parser = new options.Marked(MARKED_PROFILE);
  parser.use({
    extensions: [
      markedHighlight,
      mathBlockExtension(current),
      mathExtension(current),
      contentGapExtension,
    ],
    renderer: rendererOverrides,
  });

  const draw = (latex: string, display: boolean): string =>
    renderMath(options.katex, latex, display);

  function render(md: string): RenderResult {
    let text = md;
    for (const contribution of contributions) text = contribute(text, contribution);
    const run = beginMathRun();
    const previous = open;
    const previousHeadings = openHeadings;
    const previousHeadingAt = headingAt;
    open = run;
    openHeadings = [];
    headingAt = 0;
    try {
      // Lexed and parsed in two steps rather than `parse()`, because the gaps are
      // put in between them: a token stream is where a blank line can be told
      // from a blank line inside a code fence.
      const tokens = parser.lexer(text) as BlockToken[];
      markContentGaps(tokens);
      // After lex (math tokens already hold their ids) and before parse (which
      // is when the heading renderer runs). The list and the markup are built
      // from the same walk of the same tree, so an id the list names is an id
      // the tag carries — provided the sanitizer leaves `id` alone.
      const headings = headingIds ? collectHeadings(tokens, run) : [];
      openHeadings = headings;
      return {
        html: options.sanitize(parser.parser(tokens)),
        math: run.placeholders,
        headings,
      };
    } finally {
      open = previous;
      openHeadings = previousHeadings;
      headingAt = previousHeadingAt;
    }
  }

  /**
   * The markup into the element, the formulas into the markup, and the element
   * marked as what it now is.
   *
   * The class and the version go on here rather than being left to the consumer
   * for the same reason the sanitizer is inside `render()`: a stylesheet has to
   * have something to scope itself to, and "remember to put a class on the
   * element" is a step that gets left out — after which nothing breaks and the
   * document merely comes out unstyled. The element must be the *document*, not
   * the product's scrolling shell: a shell owns a background, a border, padding
   * and an overflow, a theme owns the same four, and one element wearing both
   * roles is an argument with no way to settle it.
   */
  function mount(container: Element, result: RenderResult): void {
    container.classList.add(DOTMD_CLASS.root);
    container.setAttribute(DOTMD_SCHEMA_ATTR, String(DOTMD_SCHEMA_VERSION));
    container.innerHTML = result.html;
    hydrateMath(container, result.math, draw);
  }

  return {
    render,
    mount,
    renderInto(container: Element, md: string): RenderResult {
      const result = render(md);
      mount(container, result);
      return result;
    },
  };
}

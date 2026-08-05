/**
 * The same note with the marks taken off: Markdown to the text underneath it.
 *
 * A subpath of its own, and not because of where the arrow points — this reads
 * the same dialect the renderer does, and that is the whole reason it is here
 * rather than in a product. `==highlight==` is a mark this Markdown may hold and
 * `marked` does not know: without the extension the text came out with four `=`
 * characters in it, which is the file's syntax showing through the very output
 * whose job was to have none. The profile is the renderer's for the same reason —
 * `breaks`, `gfm` and `html` decide where the lines fall.
 *
 * It is a subpath because a caller who wants text wants text: no formulas, no
 * contributions, no element to mount into, and no reason to carry a maths
 * hydrator they will never call. A dollar-delimited formula stays as the reader
 * wrote it, which is what the file holds — a drawn formula has no plain text, and
 * the LaTeX is the closest thing to it.
 *
 * The note it is handed is the note as saved, never the preview's markup. A
 * preview shortens URLs for a card, expands a product's blocks into something
 * else and replaces LaTeX with a drawing; text taken from it is a description of
 * a screen, not the file a person asked to export.
 */
import { markedHighlight } from './highlight.js';
import { MARKED_PROFILE } from './profile.js';
import type { MarkedConstructor, Sanitize } from './engines.js';

/** Where a line ends in the text even though the markup only implied one. */
const LINE_BLOCKS = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, tr';

export interface PlainTextOptions {
  /** The `Marked` class — one instance is built, with this dialect on it. */
  Marked: MarkedConstructor;
  /** DOMPurify, in a browser. The markup is never mounted, but it is parsed. */
  sanitize: Sanitize;
  /**
   * A document to build the throwaway element in. Handed in rather than taken
   * from a global: a service worker has no `document`, and a test drives this
   * against a document of its own.
   */
  document: Document;
}

/**
 * Markdown in, the text a person would read out loud.
 *
 * The markup is parsed into a detached element rather than stripped with regular
 * expressions, so what comes out is what a renderer would have shown: a table's
 * cells in their rows, a list's items on their own lines, an entity as its
 * character. `<br>` becomes a newline because it is one on screen, and each block
 * gets one appended because `textContent` runs the blocks together — a heading
 * and the paragraph under it came back as one word.
 */
export function createPlainTextRenderer(options: PlainTextOptions): (md: string) => string {
  const parser = new options.Marked({ ...MARKED_PROFILE, async: false });
  parser.use({ extensions: [markedHighlight] });
  const { document, sanitize } = options;

  return (md: string): string => {
    const container = document.createElement('div');
    container.innerHTML = sanitize(parser.parse(md, { async: false }));
    container.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
    container
      .querySelectorAll(LINE_BLOCKS)
      .forEach((el) => el.appendChild(document.createTextNode('\n')));
    return (container.textContent ?? '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  };
}

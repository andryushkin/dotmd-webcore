/**
 * Per-render heading ids: the list a table of contents reads, and the `id` each
 * heading tag carries, produced together so they cannot disagree.
 *
 * The counter lives on the render, never on the renderer or the module — the
 * same defect `RenderResult.math` was written to close. A module-wide map let a
 * second render hydrate its formulas into the first document's placeholders; a
 * module-wide or instance-wide heading counter would mint `title-2` on a second
 * render of the same document, and every link in the table of contents would
 * point nowhere.
 */
import { headingSlug } from './heading-slug.js';
import type { MathRun } from './maths.js';

/** One heading of the rendered document, in document order. */
export interface RenderedHeading {
  /** 1…6 — the level the tag was written at. */
  readonly level: number;
  /**
   * The plain text of the heading, as a reader would read it without markup.
   * Emphasis, links and code spans leave their text; a formula contributes its
   * LaTeX (without the dollars), never the placeholder that carries it through
   * the sanitizer. That placeholder is empty and would otherwise erase the
   * formula from both the id and the list a caller builds a TOC from.
   */
  readonly text: string;
  /** The `id` attribute written on the tag — unique within this render. */
  readonly id: string;
}

/** Enough of a `marked` token to walk headings and their inline content. */
interface WalkToken {
  type?: string;
  depth?: number;
  text?: string;
  tokens?: WalkToken[];
  items?: WalkToken[];
  literal?: string;
  id?: string;
}

/**
 * Base used when `headingSlug` returns empty — a heading with no letters, or no
 * text at all, still needs an anchor a TOC can name.
 */
const EMPTY_HEADING_BASE = 'heading';

/**
 * Plain text of a heading's inline tokens.
 *
 * `marked`'s own third argument to the heading renderer is *almost* this, built
 * with its text renderer — except a custom math token always runs its own
 * renderer, so the "plain" string arrives holding the placeholder markup. Walking
 * the tokens ourselves is what keeps a formula out of the id and out of the list.
 */
export function headingPlainText(tokens: readonly WalkToken[] | undefined, run: MathRun): string {
  if (!tokens) return '';
  let out = '';
  for (const token of tokens) {
    switch (token.type) {
      case 'text':
      case 'escape':
      case 'codespan':
        out += token.text ?? '';
        break;
      case 'math':
      case 'mathBlock': {
        // Literals are dollars that opened nothing and stand as characters.
        if (token.literal !== undefined) {
          out += token.literal;
          break;
        }
        const entry = token.id !== undefined ? run.placeholders.entries.get(token.id) : undefined;
        // LaTeX, not the placeholder and not the surrounding dollars: the list is
        // for a person and for a consumer matching a live page by text, and a
        // `data-katex` id leaking into either is a defect a reader sees.
        out += entry?.latex ?? '';
        break;
      }
      case 'br':
        out += ' ';
        break;
      case 'image':
        // Alt text is what a reader without the image is given.
        out += token.text ?? '';
        break;
      case 'html':
        // Raw HTML in a heading is rare and untrusted; nothing of it is text.
        break;
      default:
        if (token.tokens) out += headingPlainText(token.tokens, run);
        else if (typeof token.text === 'string') out += token.text;
        break;
    }
  }
  return out;
}

/**
 * Every heading in the token tree, in the order `marked` will render them, each
 * with a unique id for this render alone.
 */
export function collectHeadings(tokens: readonly WalkToken[], run: MathRun): RenderedHeading[] {
  const headings: RenderedHeading[] = [];
  const seen = new Map<string, number>();

  const uniquify = (base: string): string => {
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}-${n}`;
  };

  const walk = (list: readonly WalkToken[]): void => {
    for (const token of list) {
      if (token.type === 'heading' && typeof token.depth === 'number') {
        const text = headingPlainText(token.tokens, run);
        const base = headingSlug(text) || EMPTY_HEADING_BASE;
        headings.push({ level: token.depth, text, id: uniquify(base) });
      }
      if (token.tokens) walk(token.tokens);
      if (token.items) walk(token.items);
    }
  };

  walk(tokens);
  return headings;
}

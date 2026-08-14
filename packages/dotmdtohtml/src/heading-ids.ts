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
 *
 * Uniqueness is on the *answer*, not on a per-base counter. Counting how many
 * times `step` has been seen and minting `step-1` for the second would collide
 * with a later heading whose own slug is already `step-1` (`## Step 1`). Every
 * candidate is checked against the set of ids already handed out; the suffix
 * climbs until the slot is free. That loop always terminates: each try either
 * takes an unused string or advances the suffix, and only finitely many ids
 * have been used.
 */
export function collectHeadings(tokens: readonly WalkToken[], run: MathRun): RenderedHeading[] {
  const headings: RenderedHeading[] = [];
  const used = new Set<string>();

  const uniquify = (base: string): string => {
    let id = base;
    let n = 0;
    while (used.has(id)) {
      n += 1;
      id = `${base}-${n}`;
    }
    used.add(id);
    return id;
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

/**
 * Writes each list entry's id back onto the matching heading tag of a mounted
 * document — the repair for the ids a sanitizer took off.
 *
 * `RenderResult.headings` and the markup are built from one walk of one token
 * tree, so they cannot disagree here; what can disagree is the markup *after*
 * the sanitizer. Default DOMPurify keeps `id` in general and strips the handful
 * of names that clobber document and form properties — `title`, `body`,
 * `length`, `name` — which is exactly the vocabulary of ordinary headings: the
 * first `# Title` of a captured page produces `id="title"` and loses it, the
 * list still names it, and every table of contents built from that list scrolls
 * to nothing. Nothing fails; a control silently stops working.
 *
 * Not part of `mount()`, and that is the boundary rather than an omission. This
 * puts back an attribute the consumer's own sanitizer decided to remove, and
 * the sanitizer arrives here as an argument — the package borrowed it and does
 * not get to overrule it. A consumer that wants the anchors calls this after
 * mounting; one that strips ids on purpose simply does not.
 *
 * Invents nothing. Ids are never re-slugged here and no heading is given one it
 * did not already have in the list: the list is the whole contract, and a second
 * source of ids on this side is the drift the single walk exists to prevent. A
 * tag whose level does not match the entry in hand is skipped rather than
 * stamped — a mismatch means the walk and the tag list are describing different
 * documents (markup a note's author typed, a product's own heading injected into
 * the container), and writing the wrong id onto it is worse than leaving it bare.
 */
export function reassertHeadingIds(
  container: Element,
  headings: readonly RenderedHeading[],
): void {
  if (headings.length === 0) return;
  // `Array.from` rather than a `for…of` over the live list: a `NodeList` is only
  // iterable under a DOM lib newer than the one a consumer of this package may
  // be compiling against, and this file is type-checked from three tsconfigs.
  const nodes = Array.from(container.querySelectorAll('h1, h2, h3, h4, h5, h6'));
  let i = 0;
  for (const node of nodes) {
    if (i >= headings.length) break;
    const heading = headings[i]!;
    const level = Number(node.tagName.charAt(1));
    if (level !== heading.level) continue;
    if (node.getAttribute('id') !== heading.id) {
      node.setAttribute('id', heading.id);
    }
    i += 1;
  }
}

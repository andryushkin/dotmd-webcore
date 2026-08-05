/**
 * A run of blank lines the page left behind, shown as space rather than closed
 * up.
 *
 * The converter keeps such a run because the reader saw it; a Markdown renderer
 * collapses every run of blank lines to one paragraph break, so without this the
 * spacing a page was laid out with disappears in the preview and reappears in the
 * file — two documents from one note.
 */

export interface BlockToken {
  type: string;
  raw: string;
  tokens?: BlockToken[];
  items?: BlockToken[];
}

/**
 * Only the renderer: the token is put in after the lexer has run, not found by a
 * tokenizer. `\n{3,}` is a block boundary everywhere except inside a code block,
 * where three newlines are three newlines the reader wrote — and by the time the
 * lexer is finished, the fence has already claimed them, which is the whole
 * repair. A `String.replace` over the note reached inside the fence and turned a
 * shell listing's blank lines into a `<div>`.
 */
export const contentGapExtension = {
  name: 'contentGap',
  renderer(): string {
    return '<div class="content-gap"></div>';
  },
};

/** Newlines a block was charged on its way out. */
function trailingNewlines(raw: string): number {
  return /\n*$/.exec(raw)?.[0].length ?? 0;
}

/** Newlines a run of blank lines is made of. */
function newlineCount(raw: string): number {
  return (raw.match(/\n/g) ?? []).length;
}

/**
 * Put a gap wherever the reader left two blank lines, reading the token stream.
 *
 * The count is a boundary rather than a token, because no single token holds it.
 * A paragraph leaves the blank lines behind as a `space` token; a blockquote
 * keeps the first of them and leaves the rest, so `> a` and `> b` two blank lines
 * apart arrive as a `raw` ending in one newline and a `space` holding two; a
 * heading, a table, a rule, an HTML block and an indented block swallow the lot
 * into their own `raw`. Reading the `space` alone put the threshold one line out
 * for everything in the second group. What is asked instead is how many newlines
 * stand between the two blocks, whoever is holding them.
 *
 * Blockquotes and lists carry blocks of their own, and the page's spacing inside
 * one is the page's spacing. A list item's blank lines are charged to the item —
 * `closing` is how the walk inside it learns what the item's own `raw` says, and
 * it is a `max` rather than a sum because that `raw` already contains the space
 * token at the end of it.
 */
export function markContentGaps(tokens: BlockToken[], closing = 0): void {
  for (let i = tokens.length - 1; i >= 0; i--) {
    const token = tokens[i]!;
    const last = i === tokens.length - 1;
    if (token.type === 'blockquote' && token.tokens) markContentGaps(token.tokens);
    if (token.type === 'list' && token.items) {
      for (const item of token.items) {
        if (item.tokens) markContentGaps(item.tokens, trailingNewlines(item.raw));
      }
    }
    if (token.type === 'space') {
      const before = i > 0 ? trailingNewlines(tokens[i - 1]!.raw) : 0;
      const separation = before + newlineCount(token.raw);
      if (Math.max(separation, last ? closing : 0) >= 3) {
        tokens[i] = { type: 'contentGap', raw: token.raw };
      }
      continue;
    }
    // A `space` behind this one carries the boundary; it is visited on its own.
    if (tokens[i + 1]?.type === 'space') continue;
    const separation = Math.max(trailingNewlines(token.raw), last ? closing : 0);
    if (separation >= 3) tokens.splice(i + 1, 0, { type: 'contentGap', raw: '' });
  }
}

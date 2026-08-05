/**
 * `==highlight==`, the one marker in the dialect no standard defines.
 *
 * `htmltodotmd` writes it because the file's destination understands it —
 * Obsidian, EditMD — and neither CommonMark nor GFM has a highlight, so `marked`
 * does not know it either. Without this extension a reader was shown the four `=`
 * characters the converter had just put in their file, which reads as a defect in
 * the capture rather than as something the previewer lacks.
 *
 * It is exported on its own as well as registered by the renderer: a caller that
 * parses this dialect without rendering a document — the clipper's fidelity
 * oracle, which measures the text a reader would see — needs the same extension
 * and must not have a second spelling of it.
 */

interface HighlightToken {
  type: 'highlight';
  raw: string;
  text: string;
  tokens: unknown[];
}

/**
 * A pair, not a run: `==` opens only where a non-space follows and closes only
 * where a non-space precedes, which is what keeps `x\=\=y and C\=\=C++` — the
 * escaped comparisons the converter writes — from pairing if a backslash is ever
 * lost, and what stops a lone `==` in the middle of a sentence eating the rest of
 * the line looking for a partner.
 */
const HIGHLIGHT = /^==(?=[^\s=])([\s\S]*?[^\s=])==/;

export const markedHighlight = {
  name: 'highlight',
  level: 'inline' as const,
  // `marked` calls this to find where the next token of this kind might begin, so
  // it can skip the text in front of it in one step rather than testing every
  // character against every extension.
  start(src: string): number | undefined {
    const at = src.indexOf('==');
    return at === -1 ? undefined : at;
  },
  tokenizer(this: { lexer: { inlineTokens: (s: string) => unknown[] } }, src: string) {
    const match = HIGHLIGHT.exec(src);
    if (!match) return undefined;
    const text = match[1] ?? '';
    return {
      type: 'highlight',
      raw: match[0],
      text,
      // The content is markdown like any other inline content: a page can mark a
      // phrase that holds a link or a bolded word, and dropping to plain text
      // would show that markup as characters.
      tokens: this.lexer.inlineTokens(text),
    } satisfies HighlightToken;
  },
  renderer(this: { parser: { parseInline: (t: unknown[]) => string } }, token: HighlightToken): string {
    return `<mark>${this.parser.parseInline(token.tokens)}</mark>`;
  },
};

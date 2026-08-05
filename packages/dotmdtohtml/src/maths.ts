/**
 * Maths: two tokenizers, a placeholder each, and the map that fills them in
 * afterwards.
 *
 * The LaTeX never travels as markup. It is put aside the moment it is recognised
 * and reaches the DOM only through `hydrateMath()`, after the sanitizer has run —
 * which is why a formula cannot carry HTML into the document however it is
 * written.
 */

import { DOTMD_CLASS } from './schema.js';

/** One formula, kept aside while its placeholder travels through the sanitizer. */
export interface MathEntry {
  latex: string;
  display: boolean;
}

/**
 * The formulas of one render, and the selector that finds that render's
 * placeholders and nobody else's.
 *
 * The selector is not a convenience. The hydrator took every `[data-katex]` in
 * the container and looked its id up in a map keyed `0`, `1`, `2` — and the note
 * being rendered may hold markup its author typed by hand, which `marked` passes
 * through with `html: true`. A note containing `<span data-katex="0">KEEP</span>`
 * had the word `KEEP` replaced by whatever formula happened to be first in that
 * render. The ids carry a token drawn per render, so a note cannot name one, and
 * the hydrator asks for that token rather than for the attribute.
 */
export interface MathPlaceholders {
  /** Matches this render's placeholders. */
  readonly selector: string;
  readonly entries: Map<string, MathEntry>;
}

/** The formulas of the render that is running, and the ids left to hand out. */
export interface MathRun {
  readonly placeholders: MathPlaceholders;
  nextId(): string;
}

/** Invisible Unicode math operators from MathML (U+2061–U+2064) — KaTeX chokes. */
const INVISIBLE_MATH_CHARS = /[\u2061-\u2064]/g;

/**
 * Display maths, anchored: the tokenizer is handed the text from the current
 * position, so what came before is `marked`'s business rather than a lookbehind's.
 */
const DISPLAY_MATH = /^\$\$([\s\S]+?)\$\$/;

/**
 * Inline maths, and a price is not a formula.
 *
 * `**$129.00** ~~$159.00~~`, an ordinary product card, was read as one formula
 * from `129.00` to `159.00`, and KaTeX drew the asterisks and tildes between the
 * two amounts as mathematics. `Costs $5 and $7 in total.` went the same way.
 *
 * The three conditions are Pandoc's, and they are about the dollars rather than
 * about the body — the body between two prices is `129.00** ~~`, which no test
 * for "looks like money" would ever catch. An opening dollar is not followed by a
 * blank, a closing one is not preceded by one, and a closing one is not followed
 * by a digit. That last is what parts two amounts: the dollar of `$159.00` has a
 * `1` behind it and so cannot close anything.
 *
 * The one blank that does not part anything is the delimiter behind `\lt` and
 * `\gt`, and that exception is the other half of a pair with the converter. A
 * page may draw markup inside a formula, and `escapeMathTags` defuses it by
 * writing LaTeX's own names for the brackets — with the space LaTeX needs to tell
 * the command from the letter behind it, and eats again when the formula is
 * drawn. A formula the page ended with a tag therefore ends with that space, and
 * Pandoc's second condition threw the whole formula away: the reader was shown
 * `$\lt img src=x onerror=alert(1)\gt …$`, the file's own source, where the page
 * had drawn markup. Prose is untouched — `Costs $5 and $x` still ends in a blank
 * that no backslash put there.
 *
 * Those two commands and not every control word, though every control word
 * carries the same delimiter. The exception is worth what the pair costs and no
 * more: `Price was $12 \approx $ last year` is a sentence about mathematics, and
 * a general rule reads it as mathematics — drawing `12≈` and taking the year with
 * it. These are the two `escapeMathTags` writes, and the only two a converted
 * page can end a formula with.
 */
const INLINE_MATH = /^\$(?!\s)([^$\n]*?(?:[^$\s]|\\[lg]t ))\$(?!\d)/;

/**
 * A token no note can hold, because it does not exist until this render begins.
 *
 * Sixteen hex characters from the platform's CSPRNG. A note is edited by hand and
 * `marked` passes its markup through, so the only thing that keeps a hand-written
 * `data-katex` from being hydrated is that its value cannot be guessed.
 */
function renderToken(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The formulas of one render, owned by that render and by nothing module-wide. */
export function beginMathRun(): MathRun {
  const token = renderToken();
  let counter = 0;
  return {
    placeholders: { selector: `[data-katex^="${token}-"]`, entries: new Map() },
    nextId: () => `${token}-${counter++}`,
  };
}

/**
 * A display formula standing on its own, blank lines inside it and all.
 *
 * An inline tokenizer is only ever offered the text of one block, and a blank line
 * is where `marked` ends a block — so a formula with an empty line in it cannot be
 * reached from inline at all, however the expression is written. A multi-line
 * `\begin{aligned}` with a blank line between two of its rows is ordinary LaTeX,
 * and the note holding one was shown as two paragraphs of raw dollars and
 * backslashes — the source of a formula the file says is a formula.
 *
 * The first `$$` after the opener closes it, and it has to be the last thing on
 * its line. Neither half is decoration. A later closer is never looked for, so
 * `$$a$$ and prose` with `$$b$$` on the line below cannot be read as one formula
 * running from the first dollar to the last with the prose swallowed inside it;
 * and end-of-line is what keeps a `$$` that opens nothing from claiming the rest
 * of the note. Failing here costs nothing — the block is parsed as before and the
 * inline tokenizer draws whatever formulas the line holds.
 */
function blockMath(src: string): { raw: string; latex: string } | undefined {
  if (!src.startsWith('$$')) return undefined;
  const close = src.indexOf('$$', 2);
  // `-1` is no closer at all; `2` is `$$$$`, which holds no formula.
  if (close === -1 || close === 2) return undefined;
  const tail = /^[ \t]*(?:\n|$)/.exec(src.slice(close + 2));
  if (!tail) return undefined;
  return { raw: src.slice(0, close + 2 + tail[0].length), latex: src.slice(2, close) };
}

interface MathToken {
  type: 'math' | 'mathBlock';
  raw: string;
  /** Set instead of `id` when the dollars open nothing and stand as characters. */
  literal?: string;
  id?: string;
}

/** Puts one formula aside and hands back the id its placeholder will carry. */
function recordMath(run: MathRun, latex: string, display: boolean): string {
  const id = run.nextId();
  run.placeholders.entries.set(id, {
    latex: latex.trim().replace(INVISIBLE_MATH_CHARS, ''),
    display,
  });
  return id;
}

/** The markup a formula travels as, from either tokenizer. */
function mathMarkup(run: MathRun, token: MathToken): string {
  if (token.literal !== undefined) return token.literal;
  const entry = run.placeholders.entries.get(token.id!)!;
  // A span, not a div: a block element would open an HTML block that swallows
  // the rest of the paragraph, and the blank lines around it would end the
  // HTML block of a fallback table whose cell holds the formula. The span is
  // put back on a line of its own by `base.css`, which is what the display
  // class is for — nothing about a span says it stood alone in the note, and
  // an attribute saying so was a second, private spelling of a class the
  // schema now declares. It holds an id and never the LaTeX itself, which is
  // why the LaTeX cannot become markup: it reaches the DOM only through
  // `hydrateMath()`, after the sanitizer has run.
  const kind = entry.display ? DOTMD_CLASS.mathDisplay : DOTMD_CLASS.mathInline;
  return `<span data-katex="${token.id}" class="${DOTMD_CLASS.math} ${kind}"></span>`;
}

/**
 * Maths as a token, not as a pass over the string.
 *
 * The pass ran `String.replace` over the whole note before `marked` saw it, and a
 * regular expression over a Markdown document knows nothing about the document:
 * `` Use `$x$` literally `` lost the contents of a code span, `Costs \$x$ today`
 * had an escaped dollar eaten, and a fenced block holding `echo $PATH$HOME` — a
 * shell note, the commonest thing there is — had its variables replaced by a
 * formula. A tokenizer is asked only where `marked` is willing to start a token,
 * so code spans, fenced and indented blocks, and backslash escapes are all opaque
 * to it without a single rule about them here.
 *
 * A run of dollars that opens nothing is consumed as characters rather than left
 * for the next pass. That is what the old `(?<!\$)` and `(?!\$)` guards bought:
 * once `$$` has failed to open display maths, neither of its dollars may go on to
 * open an inline formula — `$$x$` is three characters and an `x`, not a formula
 * with a stray dollar in front.
 *
 * `current` rather than a run handed in: the parser is built once and the
 * formulas belong to one render, so the extension asks for the render that is
 * open at the moment `marked` calls it.
 */
export function mathExtension(current: () => MathRun) {
  return {
    name: 'math',
    level: 'inline' as const,
    // Where the next token of this kind might begin, so `marked` can skip the
    // text in front of it in one step instead of testing every character.
    start(src: string): number | undefined {
      const at = src.indexOf('$');
      return at === -1 ? undefined : at;
    },
    tokenizer(src: string): MathToken | undefined {
      if (src[0] !== '$') return undefined;
      const run = /^\$+/.exec(src)![0];
      const match = run.length >= 2 ? DISPLAY_MATH.exec(src) : INLINE_MATH.exec(src);
      if (!match) return { type: 'math', raw: run, literal: run };
      const id = recordMath(current(), match[1] ?? '', run.length >= 2);
      return { type: 'math', raw: match[0], id };
    },
    renderer(token: MathToken): string {
      return mathMarkup(current(), token);
    },
  };
}

/**
 * The same maths, asked at block level, which is the only level a blank line
 * survives.
 *
 * Registered beside the inline extension rather than instead of it: `$$…$$` in
 * the middle of a sentence is a formula too, and only inline can see it. This one
 * is offered the note where `marked` is about to start a block, so a fenced or
 * indented listing is opaque to it for the same reason it is opaque to the other
 * one — the fence tokenizer has already claimed the whole block by the time the
 * `$$` inside it would be looked at, and an indented line does not start with a
 * dollar.
 */
export function mathBlockExtension(current: () => MathRun) {
  return {
    name: 'mathBlock',
    level: 'block' as const,
    /**
     * Where a paragraph has to stop so the formula below it can be a block.
     *
     * Without this, `text` and then a `$$…$$` on the next line is one paragraph —
     * `marked` starts a block at the text and the formula is inside it, back at
     * inline level with the blank-line boundary that broke it. `marked` hands this
     * the note from one character in and cuts at the index returned plus one, so
     * what is wanted is the offset of the `$$` itself: the newline before it stays
     * with the paragraph.
     *
     * Only a `$$` that begins a line, and only one that would really open a block,
     * which is what keeps `costs $$5` and a mid-sentence `$$x$$` from splitting a
     * paragraph in two around them.
     */
    start(src: string): number | undefined {
      for (let at = src.indexOf('\n$$'); at !== -1; at = src.indexOf('\n$$', at + 1)) {
        if (blockMath(src.slice(at + 1))) return at + 1;
      }
      return undefined;
    },
    tokenizer(src: string): MathToken | undefined {
      const found = blockMath(src);
      if (!found) return undefined;
      const id = recordMath(current(), found.latex, true);
      return { type: 'mathBlock', raw: found.raw, id };
    },
    renderer(token: MathToken): string {
      return mathMarkup(current(), token);
    },
  };
}

/**
 * Put the formulas into the placeholders this render wrote, and only those.
 *
 * `draw` is KaTeX with `throwOnError: false`; the `catch` writes the source back
 * out as `$…$`, because a formula that cannot be drawn is still a formula the
 * file holds, and an empty span says nothing about what is missing.
 */
export function hydrateMath(
  container: Element,
  math: MathPlaceholders,
  draw: (latex: string, display: boolean) => string,
): void {
  container.querySelectorAll(math.selector).forEach((el) => {
    const entry = math.entries.get(el.getAttribute('data-katex') ?? '');
    if (!entry) return;
    try {
      el.innerHTML = draw(entry.latex, entry.display);
      el.removeAttribute('data-katex');
    } catch {
      el.textContent = entry.display ? `$$${entry.latex}$$` : `$${entry.latex}$`;
    }
  });
}

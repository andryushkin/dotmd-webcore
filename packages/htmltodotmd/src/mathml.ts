/**
 * The fallback for MathML that states no LaTeX of its own — no `alttext`, no
 * `<annotation encoding="application/x-tex">`.
 *
 * The rules in `src/rules/math.ts` read LaTeX a page already carries and never
 * invent it: a `<math>` with nothing to read converts as the glyphs its children
 * are (`<mi>a</mi><mo>+</mo><mi>b</mi>` → `a+b`), which loses the level and no
 * character. On arXiv, on anything published through LaTeXML, and on any page
 * that writes MathML by hand, that is the whole formula — and a converter can do
 * better, because MathML is the structure and the LaTeX is derivable from it.
 *
 * Deriving it needs a converter this package will not have: a MathML → LaTeX
 * implementation is thousands of lines, and the zero-dependency rule is what lets
 * this engine move into another product whole. So the *type* of the converter
 * lives here and the implementation arrives from the caller, which vendors one.
 *
 * The rule lives here rather than in the consumer, which is where it used to,
 * because everything it decides is conversion policy — it reads no computed
 * style, touches no `Range`, needs no live DOM — and because a consumer's rules
 * are consulted *before* every rule in this package. Standing outside, it claimed
 * every `<math>` it could convert, including the ones `math-element` had just
 * learnt to leave alone: a KaTeX formula with no annotation reached the file as
 * `$\frac{a}{b}$ab`, the meaning half converted here and the drawn half converted
 * after it, where the reader had seen one fraction. The filter below asks the two
 * questions `math-element` asks, from the same functions, and that is the whole
 * of what keeps the two in step.
 */
import type { Rule } from './types.js';
import { escapeMathTags } from './core/escape.js';
import { extractMath, hasDrawnTwin, isDisplay } from './rules/math.js';

/**
 * A MathML → LaTeX converter, as this package requires it.
 *
 * Synchronous, because a rule's `replacement` returns a string; given the
 * serialized element (`outerHTML`), because that is what every implementation of
 * this takes; returning **bare** LaTeX, with no `$` or `$$` around it — the
 * delimiters are this package's to write, since only it knows whether the page
 * said display.
 *
 * An empty or whitespace-only result is a **refusal**, not a formula. It is the
 * same rule `statedLatex()` states about a carrier: the shape without the
 * statement is not a statement, and a converter that met MathML it could not read
 * says so by returning nothing.
 */
export type MathMLConverter = (mathml: string) => string;

/**
 * The rule, built round a converter the caller supplies.
 *
 * There is no converter-less form on purpose. A caller with nothing to convert
 * with passes no rule at all (`rules: convert ? [createMathMLFallbackRule(convert)] : []`)
 * and gets the glyph fallback this package now does on its own — a level lost and
 * no character missing. An optional parameter would put the same outcome behind a
 * rule that silently does nothing, which is a harder thing to read and the same
 * result.
 */
export function createMathMLFallbackRule(convert: MathMLConverter): Rule {
  return {
    name: 'mathml-fallback',
    // Both halves are refusals in favour of `src/rules/math.ts`, which runs after
    // this and answers better in each case. A carrier that *states* LaTeX is read
    // rather than re-derived — the page's own source beats a round trip through
    // the structure. A carrier a renderer drew a twin beside is one half of one
    // formula, and writing it puts the formula in the file twice.
    filter: (el: Element) =>
      el.tagName.toLowerCase() === 'math' && extractMath(el) === null && !hasDrawnTwin(el),
    // `ignoresChildContent` is deliberately not set: the children are the fallback
    // this rule falls back *to*, and the converter refusing is the commonest way
    // this rule ends.
    replacement: (el: Element, childContent: string) => {
      let latex: string;
      try {
        latex = convert(el.outerHTML);
      } catch {
        // Whatever the converter threw on, the MathML the reader met is still
        // there. Returning `''` — what this did while it lived in the clipper —
        // deleted it, and a paragraph that silently did not survive a capture is
        // the loss nobody can see to report.
        return childContent;
      }
      if (!latex.trim()) return childContent;
      // Trimmed, because `$ x $` is not the formula the page showed and several
      // renderers refuse to parse it at all.
      const safe = escapeMathTags(latex.trim());
      // Same reason the rules in `src/rules/math.ts` escape: LaTeX is re-emitted
      // between dollar signs, Markdown carries raw HTML, and `<img src=x
      // onerror=…>` coming out of MathML would render.
      //
      // The page's own word on display, asked through `isDisplay` rather than off
      // the `display` attribute alone: a `.katex-display` ancestor says it too,
      // and this is the one carrier that can be under one with nothing to read
      // (KaTeX built with `output: "mathml"`).
      return isDisplay(el) ? `\n\n$$${safe}$$\n\n` : `$${safe}$`;
    },
  };
}

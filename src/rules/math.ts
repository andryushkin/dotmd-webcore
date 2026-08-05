import type { Rule } from '../types.js';
import {
  escapeMathTags,
  escapeHtmlSyntax,
  escapeInlineMarkdown,
  MATH_TAG_SHAPED,
} from '../core/escape.js';

// Two attributes are spelled `display` and mean different things, so each question
// has to be put to the element that answers it. On `<math>` it is MathML's own,
// valued `block` or `inline`: Wikipedia writes `block` on a display formula, KaTeX
// writes it on the MathML it builds in display mode, and MathJax's TeX input sets
// it on the root it hands the renderer. `display="true"` is MathJax v3's own
// spelling on its own `<mjx-container>` — it reads `block` off the `<math>` and
// writes `true` onto the container. Asked of the wrong element, each answers about
// nothing: `=== 'true'` on a `<math>` never matched, so a Wikipedia display formula
// came out inline.
function isDisplay(el: Element): boolean {
  const math = el.tagName.toLowerCase() === 'math' ? el : el.querySelector('math');
  if (math?.getAttribute('display') === 'block') return true;
  // A renderer's wrapper says it too, and is the only witness where the MathML is
  // not in the page: MathJax v3 emits `<math>` only under assistive MathML.
  if (el.closest('.katex-display')) return true;
  return el.closest('mjx-container')?.getAttribute('display') === 'true';
}

// A style command a renderer wraps round the whole formula. Wikipedia's Math
// extension writes one on every formula it publishes — `{\displaystyle …}`, and
// `{\textstyle …}` for the ones the page sets inline: 905 of 905 formulas across
// four articles carry it, 264 of them the `\textstyle` spelling. It instructs the
// renderer and is no part of what the reader was shown, so it does not belong in
// the file. It is no evidence of display either — 407 of those 905 sit on a formula
// the page set inline — which is why taking it off and `isDisplay()` are two things
// and not the one expression they used to be. `\textstyle` settles that on its own:
// it is the same wrapper stating the opposite, and `display` is the attribute that
// answers for both.
const RENDER_STYLE_WRAPPER = /^\{\\(?:display|text)style(?![a-zA-Z])([\s\S]*)\}$/;

/**
 * Takes one renderer wrapper off a formula that is nothing but a wrapper.
 *
 * Anchored at the start, and that anchor is the whole of what keeps
 * `\sum_{\displaystyle i}` intact: a command the formula uses for itself is never
 * the string's first character. The brace balance asks the same question of the
 * other end — `{\displaystyle a}+{\displaystyle b}` matches both anchors, yet the
 * leading brace is closed by the third one, and stripping the pair would emit
 * `a}+{\displaystyle b` with the groups broken.
 *
 * One wrapper comes off, not a run of them. Whatever survives the strip is the
 * article's own source: Wikipedia publishes `{\displaystyle \displaystyle \sum …}`
 * and `{\displaystyle \textstyle f:…}` where the wikitext asked for the command,
 * and that inner one is as much the formula as `\sum` is.
 */
function unwrapRenderStyle(latex: string): string {
  const match = RENDER_STYLE_WRAPPER.exec(latex);
  if (!match) return latex;
  const body = match[1] ?? '';
  let depth = 0;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    // `\{` and `\}` are braces the formula prints and `\\` is a line break; skipping
    // whatever follows a backslash keeps all three out of the count.
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    if (depth < 0) return latex;
  }
  if (depth !== 0) return latex;
  // `{\displaystyle \gamma }` — 904 of the 905 pad the body on one side or the
  // other, and `$\gamma $` is not the formula the page showed. A body that is
  // nothing but padding is left wrapped: `$$` is a fence, and a wrapper on show
  // costs characters where an empty pair of delimiters costs the line around it.
  return body.trim() || latex;
}

export const TEX_ANNOTATION = 'annotation[encoding="application/x-tex"]';

/**
 * The LaTeX a carrier *states*, or null where it states none.
 *
 * Blank is not a statement, and the trim is the whole of what says so. Both
 * spellings ship: an `<annotation encoding="application/x-tex">` holding
 * whitespace, and a `<script type="math/tex">` a renderer emptied after reading
 * it. Each was read as a formula successfully extracted — `$$` went into the
 * file where the reader saw a formula, and `ignoresChildContent` took the rest
 * of the carrier's subtree with it, so `math: true` returned less than
 * `math: false` on the same markup.
 *
 * One spelling for both readers: the sanitizer decides what an invisible box
 * carries with this same question (`isMathCarrier` in `src/core/sanitizer.ts`),
 * and a second definition would let a box be spared as a carrier here and read
 * as empty there.
 */
export function statedLatex(el: Element): string | null {
  const tag = el.tagName.toLowerCase();
  if (tag === 'annotation') {
    if (el.getAttribute('encoding') !== 'application/x-tex') return null;
    return (el.textContent ?? '').trim() || null;
  }
  if (tag === 'script') {
    if (!(el.getAttribute('type') ?? '').startsWith('math/tex')) return null;
    return (el.textContent ?? '').trim() || null;
  }
  if (tag === 'math') return (el.getAttribute('alttext') ?? '').trim() || null;
  return null;
}

function readMath(el: Element): { latex: string; display: boolean } | null {
  // 1. <annotation encoding="application/x-tex"> — KaTeX, MathJax v3, Wikipedia
  const annotation = el.querySelector(TEX_ANNOTATION);
  const annotated = annotation ? statedLatex(annotation) : null;
  if (annotated) return { latex: annotated, display: isDisplay(el) };
  // 2. MathJax v2: <script type="math/tex">
  if (el.tagName.toLowerCase() === 'script') {
    const script = statedLatex(el);
    const type = el.getAttribute('type') ?? '';
    if (script) return { latex: script, display: type.includes('mode=display') };
  }
  // 3. Wikipedia <math alttext="...">
  if (el.tagName.toLowerCase() === 'math') {
    const alttext = statedLatex(el);
    if (alttext) return { latex: alttext, display: isDisplay(el) };
  }
  return null;
}

// The wrapper comes off here, once, whichever branch above read the LaTeX. It used
// to come off inside branch 3, which reads an attribute the live shape carries but
// never gets asked for: a real Wikipedia `<math>` holds the same wrapped string in
// `alttext` *and* in an `<annotation>`, branch 1 answers first, and every formula
// on the page reached the file wrapped. KaTeX renders `{\displaystyle E=mc^{2}}` as
// the formula, so the panel looked right and only the saved file was wrong.
function extractMath(el: Element): { latex: string; display: boolean } | null {
  const read = readMath(el);
  if (!read) return null;
  return { latex: unwrapRenderStyle(read.latex), display: read.display };
}

function toMathString(latex: string, display: boolean): string {
  const safe = escapeMathTags(latex);
  return display ? `$$${safe}$$` : `$${safe}$`;
}

// LaTeX is a language, and a string using none of it is not a formula — it is text
// somebody ran through a renderer. `\`, `^`, `_`, `{`, `}` and `&` are the whole of
// what separates the two: every command, every script, every group and every
// alignment character is one of them, so `E = mc^2`, `\frac{a}{b}` and `\alpha` all
// answer yes on their first special character, while `a < b` answers no.
const LATEX_SYNTAX = /[\\^_{}&]/;

// Everything the wrapper holds that is not a carrier — the half a renderer draws.
// Taken from a clone, because the page's own nodes are what a later rule converts
// and the capture must not be edited on the way past.
function drawnText(el: Element): string {
  // A carrier standing on its own has no drawn half to offer: what a `<math>` holds
  // is the formula again in MathML, and a `<script type="math/tex">` holds the very
  // LaTeX being read. Neither is anything the reader was shown.
  const tag = el.tagName.toLowerCase();
  if (tag === 'math' || tag === 'script') return '';
  const clone = el.cloneNode(true) as Element;
  // Every shape a carrier comes in, not only the MathML one: `<annotation>` is read
  // straight off the wrapper where a page writes no `<math>` around it, and leaving
  // it in made the drawn half read back as the LaTeX itself.
  const carriers = 'math, annotation, mjx-assistive-mml, .katex-mathml, script[type^="math/tex"]';
  // `Array.from` rather than iterating the NodeList: this package is isomorphic,
  // and a `NodeListOf` is only iterable where the DOM lib says so — linkedom and
  // a server caller answer differently, which is what `tsc --noEmit` reports here.
  for (const carrier of Array.from(clone.querySelectorAll(carriers))) {
    carrier.remove();
  }
  return (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
}

// The two halves of one formula, in each renderer's own spelling: the box it puts
// the carrier in, and the branch it draws beside that box. KaTeX writes
// `.katex-mathml` next to `.katex-html`, MathJax v3 `<mjx-assistive-mml>` next to
// `<mjx-math>`, Wikipedia's Math extension a `mwe-math-mathml-*` box next to
// whichever `mwe-math-fallback-*` it published. The Wikipedia halves are matched on
// the stem of the class rather than named one at a time, for the reason the wrapper
// rules settle the duplication at all: the extension chooses between a picture and
// the TeX as text today, and a list would have to be taught the next one it adds.
const DRAWN_PAIRS: ReadonlyArray<readonly [box: string, drawn: string]> = [
  ['.katex-mathml', '.katex-html'],
  ['mjx-assistive-mml', 'mjx-math'],
  ['[class*="mwe-math-mathml"]', '[class*="mwe-math-fallback"]'],
];

// Any of the three, for the carrier no renderer boxed and whose renderer therefore
// has no name here.
const DRAWN_HALF = DRAWN_PAIRS.map(([, drawn]) => drawn).join(', ');

// Adjacent siblings and no further. All three renderers write the two halves next
// to each other, and reading a whole sibling list would put a page of N formulas
// under one wrapper back on the N² this replaced.
function drawnBeside(el: Element, drawn: string): boolean {
  return (
    el.previousElementSibling?.matches(drawn) === true ||
    el.nextElementSibling?.matches(drawn) === true
  );
}

/**
 * Whether a renderer drew this carrier's formula beside it.
 *
 * The question a bare `<math>` has to answer once it is allowed to convert at
 * all. Where nothing else was drawn it is the only witness of the formula and
 * its children are what the reader met; where a renderer drew a half beside it,
 * those same children are the second copy of one formula — `\frac{a}{b}` measures
 * as `ab`, and the file said `abab` where the page showed one fraction.
 *
 * The named half is asked, never the wrapper's text. Reading the wrapper minus its
 * carriers meant *any* text answered for a drawing: a caption, a copy button or an
 * equation number standing in the wrapper claimed the pair, and `<span
 * class="katex"><math><mi>a</mi></math><span>note</span></span>` lost the `a`
 * outright — while a wrapper nested in a wrapper answered for the outer carrier
 * with the inner one's drawing. Both are text the reader saw and the file did not
 * get, which is the one direction this setting must never take.
 *
 * Presence, not text. Wikipedia draws most of its formulas as an `<img>`, and an
 * image has no `textContent`: read as "nothing was drawn", it let the MathML
 * through beside a picture of the same formula, and a reader who saw one fraction
 * got `ab![a over b](…)` — two records of it, the second carrying the LaTeX in its
 * alt text. Whether the drawn half writes characters is that half's rule to answer;
 * that a drawing exists is this one's.
 *
 * The box is where the pairing is asked, because the drawn half is the box's
 * sibling and not the wrapper's. A carrier no renderer boxed stands in the box's
 * place: that is a page writing MathML by hand beside a fallback, and no renderer's
 * name is on it, so any of the three drawings answers.
 */
function hasDrawnTwin(el: Element): boolean {
  for (const [box, drawn] of DRAWN_PAIRS) {
    const boxed = el.closest(box);
    if (boxed && drawnBeside(boxed, drawn)) return true;
  }
  return drawnBeside(el, DRAWN_HALF);
}

/**
 * What the wrapper writes: the formula where the annotation states one, and what
 * the page drew where it does not.
 *
 * A carrier holding no LaTeX syntax is the case the screen has to settle, and it
 * is settled the way everything else here is — by what the reader met. `x <x-foo
 * style="position:fixed">X</x-foo> y` is a string a page rendered as `x custom X
 * y`, and reading it as a formula put an attribute into the file that stood
 * nowhere on screen, with `\lt`/`\gt` spent defusing markup that was never the
 * reader's to see. Where the two agree the choice costs nothing — `a < b` is drawn
 * `a < b` — and where they disagree the drawing is the only one of them anybody
 * looked at.
 *
 * A real formula never reaches this branch: it cannot be written without a
 * command, a script or a group, and `E = mc^2` beside its drawn `E = mc²` stays
 * `$E = mc^2$` — which is the case the whole maths path exists for, and the reason
 * the test is on the LaTeX rather than on whether the two halves match.
 */
function wrapperOutput(el: Element): string {
  const result = extractMath(el);
  if (!result) return '';
  // Markup is the second way an annotation states it is not what the page drew,
  // and it is the one that survives a formula around it: `\frac{a}{b} <x-foo
  // style="position:fixed">X</x-foo>` uses the language on its first half, so the
  // syntax test alone answered "formula" and the attribute rode into the file
  // again, defused but never on screen. One `^` was the whole of what it took.
  if (!LATEX_SYNTAX.test(result.latex) || MATH_TAG_SHAPED.test(result.latex)) {
    const drawn = drawnText(el);
    // Nothing drawn leaves the annotation as the only witness there is, and a
    // formula on show beats a formula deleted.
    if (drawn) return escapeHtmlSyntax(escapeInlineMarkdown(drawn));
  }
  return toMathString(result.latex, result.display);
}

export const MATH_RULES: Rule[] = [
  {
    name: 'katex',
    // The LaTeX comes from the element, so converting the rendered subtree —
    // hundreds of nodes on a Wikipedia or arXiv page — is work thrown away.
    ignoresChildContent: true,
    // And the filter asks for that LaTeX, for the reason `mwe-math-element`
    // below does: claiming the wrapper with nothing to read returns the empty
    // string, and `ignoresChildContent` then deletes the drawing as well. KaTeX
    // with `output: "html"` builds no MathML at all, so the class is there and
    // the annotation is not — `E=mc²` left the page altogether, and with `math`
    // off the same capture kept it.
    filter: (el) => el.classList.contains('katex') && extractMath(el) !== null,
    replacement: (el) => wrapperOutput(el),
  },
  {
    name: 'mjx-container',
    ignoresChildContent: true,
    // Same question, and MathJax v3 answers it no more reliably: the assistive
    // MathML the annotation lives in comes from the a11y extension, and a page
    // loading `tex-chtml` without it draws `<mjx-math>` and nothing else.
    filter: (el) => el.tagName.toLowerCase() === 'mjx-container' && extractMath(el) !== null,
    replacement: (el) => wrapperOutput(el),
  },
  // The third renderer wrapper, and the one that holds a picture beside the
  // meaning. Wikipedia's Math extension publishes both halves of every formula —
  // an invisible `<math>` for anything that is not an eye, and a drawing for the
  // eye: an `<img class="mwe-math-fallback-image-*">` of an SVG, or a `<span
  // class="mwe-math-fallback-source-*">` of the TeX. Once the sanitizer stops
  // deleting the carrier, both halves convert and the reader who saw one formula
  // gets a formula and a picture of it.
  //
  // Settled here rather than by refusing the picture, for the same reason
  // `.katex` and `<mjx-container>` are: the wrapper is the only element that
  // knows the two are one formula, and it says so whichever fallback the
  // extension chose — including the source-text one, which no rule about images
  // would have covered, and the next one it adds. `ignoresChildContent` is what
  // makes that true; the `<a>` to Wikidata that Wikipedia wraps round the pair
  // goes the same way, and it was never the formula either.
  //
  // The filter asks for the LaTeX rather than the class alone. In `source` mode
  // the extension emits no MathML at all, and a rule claiming that wrapper with
  // nothing to read would return the empty string and delete the TeX the reader
  // was actually shown.
  {
    name: 'mwe-math-element',
    ignoresChildContent: true,
    filter: (el) => el.classList.contains('mwe-math-element') && extractMath(el) !== null,
    replacement: (el) => wrapperOutput(el),
  },
  {
    name: 'math-script-v2',
    ignoresChildContent: true,
    filter: (el) => {
      if (el.tagName.toLowerCase() !== 'script') return false;
      return (el.getAttribute('type') ?? '').startsWith('math/tex');
    },
    replacement: (el) => wrapperOutput(el),
  },
  // The carrier itself, where no wrapper claimed it first. The filter asks the
  // same question the three above do, and for the same reason: claiming a `<math>`
  // with nothing to read returned the empty string, and `ignoresChildContent`
  // then deleted the MathML the reader was shown — `<math><mrow><mi>a</mi>
  // <mo>+</mo><mi>b</mi></mrow></math> in a sentence` came back as the sentence
  // with a hole in it, while the same capture with `math` off kept `a+b`.
  //
  // Where it has no formula to state it converts as the glyphs its children are,
  // exactly as `math: false` converts them — a level lost, no character missing.
  // The second half of the filter is what keeps that from doubling a formula a
  // renderer drew beside the carrier.
  {
    name: 'math-element',
    ignoresChildContent: true,
    filter: (el) =>
      el.tagName.toLowerCase() === 'math' && (extractMath(el) !== null || hasDrawnTwin(el)),
    replacement: (el) => wrapperOutput(el),
  },
];

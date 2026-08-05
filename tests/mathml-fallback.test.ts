/**
 * The rule for MathML that states no LaTeX of its own (`src/mathml.ts`).
 *
 * It used to live in the clipper, outside this package, and that is the defect
 * most of these cases are about: a consumer's rules are consulted before every
 * rule here, so it claimed carriers `math-element` had just learnt to leave
 * alone. A KaTeX formula with no annotation reached the file as
 * `$\frac{a}{b}$ab` — the meaning half converted by the consumer, the drawn half
 * converted after it — where the reader had seen one fraction.
 */
import { describe, it, expect, beforeAll } from 'bun:test';
import { parseHTML } from 'linkedom';
import { toMarkdown, setDOMAdapter } from '../src/server.js';
import { createMathMLFallbackRule } from '../src/mathml.js';
import type { MathMLConverter } from '../src/mathml.js';

beforeAll(() => {
  setDOMAdapter((html) => parseHTML(html).document as unknown as Document);
});

/** Stands in for a real MathML → LaTeX library, and records what it was asked. */
function stubConverter(answer: MathMLConverter): MathMLConverter & { calls: string[] } {
  const calls: string[] = [];
  const convert = (mathml: string): string => {
    calls.push(mathml);
    return answer(mathml);
  };
  return Object.assign(convert, { calls });
}

const FRACTION = () => '\\frac{a}{b}';

function md(html: string, convert: MathMLConverter | null): string {
  return toMarkdown(html, {
    math: true,
    rules: convert ? [createMathMLFallbackRule(convert)] : [],
  }).trim();
}

describe('MathML with no LaTeX of its own', () => {
  it('writes what the converter derived, where the carrier stands alone', () => {
    const html = '<p>x <math><mrow><mi>a</mi><mo>+</mo><mi>b</mi></mrow></math> y</p>';
    expect(md(html, () => 'a + b')).toBe('x $a + b$ y');
  });

  // The case the whole rule exists for: arXiv and anything published through
  // LaTeXML write MathML and no LaTeX beside it, so the structure is the only
  // source there is — and the glyphs are a poor reading of it (`\frac{a}{b}`
  // measures as `ab`, the denominator standing first in the DOM).
  it('beats the glyph fallback the library does on its own', () => {
    const html = '<p>x <math><mfrac><mi>a</mi><mi>b</mi></mfrac></math> y</p>';
    expect(md(html, FRACTION)).toBe('x $\\frac{a}{b}$ y');
    expect(md(html, null)).toBe('x ab y');
  });

  it('asks the page about display, not the converter', () => {
    const block = '<p>x</p><math display="block"><mi>a</mi></math><p>y</p>';
    expect(md(block, FRACTION)).toContain('$$\\frac{a}{b}$$');
    // KaTeX built with `output: "mathml"` draws no second half, so this is the
    // one carrier that can sit under `.katex-display` with nothing to read.
    const katex = '<span class="katex-display"><span class="katex"><math><mi>a</mi></math></span></span>';
    expect(md(katex, FRACTION)).toContain('$$\\frac{a}{b}$$');
  });

  it('defuses markup the converter hands back', () => {
    expect(md('<p><math><mi>a</mi></math></p>', () => '<img src=x onerror=alert(1)>')).not.toContain(
      '<img',
    );
  });
});

// The half of the filter that keeps one formula from being written twice. Each
// renderer boxes the carrier and draws its own half beside that box, and the
// two measure the same — so writing both puts `$\frac{a}{b}$ab` where the reader
// saw one fraction.
describe('a renderer drew the formula beside the carrier', () => {
  const pairs: Array<[string, string, string]> = [
    [
      'KaTeX with no annotation',
      '<span class="katex"><span class="katex-mathml"><math><mfrac><mi>a</mi><mi>b</mi></mfrac></math></span><span class="katex-html">ab</span></span>',
      'x ab y',
    ],
    [
      'MathJax v3 assistive MathML with no TeX',
      '<mjx-container><mjx-assistive-mml><math><mrow><mi>a</mi><mo>+</mo><mi>b</mi></mrow></math></mjx-assistive-mml><mjx-math>a+b</mjx-math></mjx-container>',
      'x a+b y',
    ],
    [
      'Wikipedia drawing its fallback as a picture',
      '<span class="mwe-math-element"><span class="mwe-math-mathml-inline"><math><mfrac><mi>a</mi><mi>b</mi></mfrac></math></span><img class="mwe-math-fallback-image-inline" src="g.svg" alt="a/b"></span>',
      'x ![a/b](g.svg) y',
    ],
  ];

  for (const [name, subject, expected] of pairs) {
    it(`writes the drawing alone: ${name}`, () => {
      const convert = stubConverter(FRACTION);
      expect(md(`<p>x ${subject} y</p>`, convert)).toBe(expected);
      expect(convert.calls).toEqual([]);
    });
  }

  // A caption, a copy button or an equation number is not a drawn half, and
  // reading any text in the wrapper as one deleted the formula outright.
  it('a caption beside the carrier is not a drawing', () => {
    const html =
      '<p>x <span class="katex"><span class="katex-mathml"><math><mi>a</mi></math></span><span>note</span></span> y</p>';
    expect(md(html, FRACTION)).toBe('x $\\frac{a}{b}$note y');
  });
});

// The other half: a page that already carries LaTeX is read, never re-derived.
// Its own source is what the author wrote; a round trip through the structure is
// a guess at it.
describe('the page states the formula itself', () => {
  const carriers: Array<[string, string, string]> = [
    ['Wikipedia alttext', '<math alttext="\\gamma"><mi>g</mi></math>', '$\\gamma$'],
    [
      'a TeX annotation',
      '<math><semantics><annotation encoding="application/x-tex">E = mc^2</annotation></semantics></math>',
      '$E = mc^2$',
    ],
  ];

  for (const [name, subject, expected] of carriers) {
    it(`leaves it to the library: ${name}`, () => {
      const convert = stubConverter(FRACTION);
      expect(md(`<p>${subject}</p>`, convert)).toBe(expected);
      expect(convert.calls).toEqual([]);
    });
  }

  // `statedLatex()` is what says so, and it is the same reading the library's own
  // rules use: the shape without the statement is not a statement.
  it('a blank annotation states nothing, so the converter is asked', () => {
    const html =
      '<p><math><semantics><annotation encoding="application/x-tex">   </annotation></semantics></math></p>';
    expect(md(html, FRACTION)).toBe('$\\frac{a}{b}$');
  });
});

// Deleting text costs more than adding characters. Every way this rule can fail
// ends with the children the reader met, never with the empty string — which is
// what it returned while it lived in the clipper.
describe('the converter cannot answer', () => {
  const refusals: Array<[string, MathMLConverter]> = [
    ['returns nothing', () => ''],
    ['returns whitespace', () => '  \n '],
    [
      'throws',
      () => {
        throw new Error('unsupported element');
      },
    ],
  ];

  for (const [name, convert] of refusals) {
    it(`keeps the glyphs the MathML holds: ${name}`, () => {
      const html = '<p>x <math><mrow><mi>a</mi><mo>+</mo><mi>b</mi></mrow></math> y</p>';
      expect(md(html, convert)).toBe('x a+b y');
    });
  }
});

import { describe, it, expect } from 'bun:test';
import { Marked } from 'marked';
import { markedHighlight } from '../src/highlight.js';
import { MARKED_PROFILE } from '../src/profile.js';

/**
 * The real `marked`, described the way `src/engines.ts` describes it.
 *
 * Its published types model an extension down to the token it returns, and this
 * package's do not: a token type `marked` has never heard of is the whole point
 * of an extension, and modelling somebody else's parser is what `engines.ts`
 * refuses to do. Nothing about the dialect is checked by that cast — the
 * assertions below are.
 */
interface InlineParser {
  use(extension: { extensions: readonly unknown[] }): void;
  parseInline(md: string): string;
}

const parser = new Marked(MARKED_PROFILE) as unknown as InlineParser;
parser.use({ extensions: [markedHighlight] });
const render = (md: string) => parser.parseInline(md);

// `htmltodotmd` writes `==highlight==` because the file's destination understands
// it. A renderer that does not know the marker showed a reader the four `=`
// characters just put into their own file, which reads as a defect in the capture
// rather than as something the preview lacks.
describe('==highlight==', () => {
  it('becomes a <mark>', () => {
    expect(render('A ==marked phrase== here.')).toBe('A <mark>marked phrase</mark> here.');
  });

  it('keeps its contents as markup', () => {
    expect(render('==a **b** [c](https://e.com)==')).toContain('<strong>b</strong>');
  });

  // Exactly what the converter escapes literal comparisons for: the broken pair
  // is drawn as characters and highlights nothing.
  it('leaves escaped comparisons alone', () => {
    expect(render('x\\=\\=y and C\\=\\=C++')).toBe('x==y and C==C++');
  });

  it.each([
    ['unpaired', 'unpaired == in a sentence.'],
    ['empty', 'nothing between ==== them.'],
    ['a space after the opener', 'a == b == c'],
  ])('highlights nothing: %s', (_name, md) => {
    expect(render(md)).not.toContain('<mark>');
  });
});

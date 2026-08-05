import { describe, test, expect, beforeEach } from 'bun:test';
import { Window } from 'happy-dom';
import { Marked } from 'marked';
import {
  createMarkdownRenderer,
  hydrateMath,
  type KatexEngine,
  type MarkdownContribution,
  type MarkdownRenderer,
  type RendererOptions,
} from '../src/index.js';

let win: Window;
let container: Element;

beforeEach(() => {
  win = new Window();
  // Cast on the way out, not on the way in: happy-dom's nodes are its own types,
  // and only the package's argument has to look like a DOM `Element`.
  const div = win.document.createElement('div');
  win.document.body.appendChild(div);
  container = div as unknown as Element;
});

/** KaTeX, as far as this package is concerned: a formula that says what it holds. */
const katex: KatexEngine = {
  renderToString: (latex, options) =>
    `<span class="katex" data-mode="${options.displayMode ? 'display' : 'inline'}">${latex}</span>`,
};

/** The consumer sanitizes; a test that wants to see the markup does not. */
const asIs = (html: string) => html;

function renderer(overrides: Partial<RendererOptions> = {}): MarkdownRenderer {
  return createMarkdownRenderer({
    Marked: Marked as unknown as RendererOptions['Marked'],
    sanitize: asIs,
    katex,
    ...overrides,
  });
}

/** The document a reader ends up in front of. */
function mounted(md: string, overrides: Partial<RendererOptions> = {}): Element {
  renderer(overrides).renderInto(container, md);
  return container;
}

/** The markup, formulas and all, as one string to make a claim about. */
function html(md: string, overrides: Partial<RendererOptions> = {}): string {
  return mounted(md, overrides).innerHTML;
}

/** What the reader ends up looking at. The block tags leave a newline behind. */
function text(md: string, overrides: Partial<RendererOptions> = {}): string {
  return (mounted(md, overrides).textContent ?? '').trim();
}

describe('what the render shows', () => {
  test('a formula is drawn', () => {
    expect(html('Euler: $e^{i\\pi}+1=0$ done')).toContain(
      '<span class="katex" data-mode="inline">e^{i\\pi}+1=0</span>',
    );
  });

  test('display maths is drawn in display mode', () => {
    expect(html('a\n\n$$x+y$$\n\nb')).toContain('data-mode="display">x+y<');
  });

  // The placeholder is what keeps the LaTeX out of the markup: it reaches the DOM
  // through the hydrator, after the sanitizer, and never as a `<div>` — a block
  // element there would open an HTML block and swallow the rest of the paragraph.
  test('the LaTeX never travels as markup', () => {
    const { html: markup } = renderer().render('$a<b$');
    expect(markup).not.toContain('a<b');
    expect(markup).toContain('<span data-katex=');
    expect(markup).not.toContain('<div data-katex=');
  });

  // Sanitizing is inside `render()`, not left to whoever mounts the result: the
  // consumer who assembles the order themselves is the consumer who leaves this
  // step out.
  test('what `render()` hands back has been sanitized', () => {
    let seen = '';
    const result = renderer({
      sanitize: (h) => {
        seen = h;
        return '<p>sanitized</p>';
      },
    }).render('# heading');
    expect(seen).toContain('<h1>heading</h1>');
    expect(result.html).toBe('<p>sanitized</p>');
  });

  test('and nothing else reaches the element', () => {
    expect(html('# heading', { sanitize: () => '<p>sanitized</p>' })).toBe('<p>sanitized</p>');
  });

  // The panel renders on every keystroke. An asynchronous parser gives a race in
  // which a render started earlier finishes later and overwrites newer text.
  test('a render is finished by the time it returns', () => {
    const result = renderer().render('# heading');
    expect(result).not.toBeInstanceOf(Promise);
    expect(result.html).toContain('<h1>heading</h1>');
  });

  // A formula that cannot be drawn is still a formula the file holds, and an
  // empty span says nothing about what is missing.
  test('a formula KaTeX refuses is written back out as its source', () => {
    const thrower: KatexEngine = {
      renderToString: () => {
        throw new Error('nope');
      },
    };
    expect(text('$x^2$', { katex: thrower })).toContain('$x^2$');
    expect(text('$$x^2$$', { katex: thrower })).toContain('$$x^2$$');
  });

  // The adapter is narrow on purpose: a consumer handing over a "compatible"
  // `renderToString` is a consumer who can turn any of these the other way.
  test('the typesetter is called the way this package decided', () => {
    const calls: unknown[] = [];
    const recorder: KatexEngine = {
      renderToString: (latex, options) => {
        calls.push(options);
        return latex;
      },
    };
    html('$x$ and\n\n$$y$$', { katex: recorder });
    expect(calls).toEqual([
      { displayMode: false, throwOnError: false, output: 'html', trust: false },
      { displayMode: true, throwOnError: false, output: 'html', trust: false },
    ]);
  });

  test('`==highlight==` is a mark, not four equals signs', () => {
    expect(html('a ==marked== b')).toContain('<mark>marked</mark>');
  });

  test('two blank lines are shown as a gap', () => {
    expect(html('a\n\n\n\nb')).toContain('<div class="content-gap"></div>');
  });

  test.each([
    ['after a heading', '# h\n\n\n\nb'],
    ['after a table', '| a |\n| - |\n\n\n\nb'],
    ['after a fence', '```\nx\n```\n\n\n\nb'],
    ['after a rule', '---\n\n\n\nb'],
  ])('a gap survives the block that swallowed the blank lines: %s', (_name, md) => {
    expect(html(md)).toContain('<div class="content-gap"></div>');
  });

  test('one blank line is not a gap', () => {
    expect(html('a\n\nb')).not.toContain('content-gap');
  });

  // A blockquote and a list hold blocks of their own, and the spacing the page
  // left inside one is the page's spacing too.
  test.each([
    ['a blockquote', '> a\n>\n>\n>\n> b'],
    ['a list', '- a\n\n\n\n- b'],
  ])('the blank lines inside %s are a gap as well', (_name, md) => {
    expect(html(md)).toContain('<div class="content-gap"></div>');
  });

  // Two blank lines is two blank lines whoever holds the newlines. A blockquote
  // keeps the first of them in its own `raw` and a list item keeps all of them,
  // so counting the `space` token alone put the threshold one line out for both:
  // `- a`, two blank lines, `- b` showed no gap while the same spacing between
  // two paragraphs did.
  test.each([
    ['between paragraphs', 'a\n\n\nb'],
    ['between blockquotes', '> a\n\n\n> b'],
    ['between list items', '- a\n\n\n- b'],
    ['between ordered items', '1. a\n\n\n2. b'],
    ['inside a nested list', '- a\n  - b\n\n\n  - c'],
  ])('exactly two blank lines are a gap: %s', (_name, md) => {
    expect(html(md)).toContain('<div class="content-gap"></div>');
  });

  test.each([
    ['between paragraphs', 'a\n\nb'],
    ['between blockquotes', '> a\n\n> b'],
    ['between list items', '- a\n\n- b'],
  ])('one blank line is not, either: %s', (_name, md) => {
    expect(html(md)).not.toContain('content-gap');
  });
});

// A product's own block: a range of the note it consumes and the markup that
// stands in its place. Never a free `md => md`, which is a second parser nobody
// declared — the maths pass this package replaced was one of those.
describe('a contribution', () => {
  const frontMatter: MarkdownContribution = {
    name: 'test-front-matter',
    stage: 'before-parse',
    consumes: /---\ntitle: (.*)\n---/g,
    render: (match) => `\n\n<div class="card">${match[1]}</div>\n\n`,
  };

  test('replaces the range it consumes, and only that', () => {
    const markup = html('---\ntitle: x\n---\n\nbody', { contributions: [frontMatter] });
    expect(markup).toContain('<div class="card">x</div>');
    expect(markup).toContain('<p>body</p>');
  });

  // The block is not necessarily at the top of the file: a second capture is
  // appended to a note that already has one.
  test('is applied everywhere it matches, not once', () => {
    const markup = html('---\ntitle: a\n---\n\nbody\n\n---\ntitle: b\n---\n', {
      contributions: [frontMatter],
    });
    expect(markup).toContain('<div class="card">a</div>');
    expect(markup).toContain('<div class="card">b</div>');
  });

  // A global expression carries `lastIndex` from wherever it was last used, and
  // `matchAll` begins there while `String.replace` resets it. A caller who asked
  // `consumes.test(md)` — an ordinary thing to do with an expression one owns —
  // would otherwise have the scan start mid-note, and every block above that
  // point would vanish without a word.
  test('starts at the top of the note whatever the expression last matched', () => {
    frontMatter.consumes.test('---\ntitle: somewhere else\n---');
    expect(frontMatter.consumes.lastIndex).toBeGreaterThan(0);
    expect(html('---\ntitle: x\n---\n\nbody', { contributions: [frontMatter] })).toContain(
      '<div class="card">x</div>',
    );
  });

  test('is sanitized with the rest of the document', () => {
    let seen = '';
    renderer({
      contributions: [frontMatter],
      sanitize: (h) => {
        seen = h;
        return h;
      },
    }).render('---\ntitle: x\n---');
    expect(seen).toContain('<div class="card">x</div>');
  });

  test('is applied in the order given', () => {
    const first: MarkdownContribution = {
      name: 'first',
      stage: 'before-parse',
      consumes: /A/g,
      render: () => 'B',
    };
    const second: MarkdownContribution = {
      name: 'second',
      stage: 'before-parse',
      consumes: /B/g,
      render: () => 'C',
    };
    expect(text('A', { contributions: [first, second] })).toBe('C');
    expect(text('A', { contributions: [second, first] })).toBe('B');
  });
});

// A bare pair of dollars is what a price looks like. The three conditions are
// Pandoc's and they are about the dollars, not the body.
describe('a price is not a formula', () => {
  test.each([
    ['a product card', '**$129.00** ~~$159.00~~'],
    ['two amounts in a sentence', 'Costs $5 and $7 in total.'],
    ['a range', 'It costs $20 to $30 per unit.'],
    ['a lone dollar', 'total: $'],
    ['a dollar and a space', 'costs $ 5'],
  ])('%s', (_name, md) => {
    expect(html(md)).not.toContain('class="katex"');
  });

  test('the amounts are still shown', () => {
    expect(text('**$129.00** ~~$159.00~~')).toBe('$129.00 $159.00');
  });
});

// The pass used to be `String.replace` over the whole note, which knows nothing
// about the document it is rewriting. Each of these lost text the reader wrote.
describe('the maths pass is opaque to what is not prose', () => {
  test('a code span keeps its dollars', () => {
    expect(text('Use `$x$` literally')).toBe('Use $x$ literally');
  });

  test('an escaped dollar is not eaten', () => {
    expect(text('Costs \\$x$ today')).toBe('Costs $x$ today');
  });

  // `$PATH` in a shell listing is the commonest thing there is, which is what
  // made this reachable from any note about a terminal.
  test('a fenced block keeps its shell variables', () => {
    expect(text('```sh\necho $PATH$HOME\n```')).toContain('echo $PATH$HOME');
  });

  test('an indented block keeps them too', () => {
    expect(text('    echo $PATH$HOME')).toContain('echo $PATH$HOME');
  });

  test('a code span inside a table cell keeps them', () => {
    expect(text('| a |\n| - |\n| `$y$` |')).toContain('$y$');
  });

  // The same pass collapsed blank lines into a gap `<div>`, and a fence is where
  // three newlines are three newlines somebody wrote.
  test('blank lines inside a fence stay blank lines', () => {
    expect(mounted('```js\na\n\n\nb\n```').textContent).toContain('a\n\n\nb');
    expect(html('```js\na\n\n\nb\n```')).not.toContain('content-gap');
  });

  test('an indented block is not split in two by its own blank lines', () => {
    expect(html('    a\n\n\n    b').match(/<pre>/g)?.length ?? 0).toBe(1);
  });

  test('an autolink keeps the dollars in its target', () => {
    expect(html('<https://e.com/a$b$c>')).toContain('href="https://e.com/a$b$c"');
  });

  test('prose around the exceptions still converts', () => {
    expect(html('`$a$` and $b$')).toContain('data-mode="inline">b<');
  });
});

// An inline tokenizer is only ever offered the text of one block, and a blank line
// is where `marked` ends a block. A `\begin{aligned}` with an empty line between
// two of its rows is ordinary LaTeX, and a note holding one was shown as two
// paragraphs of raw dollars and backslashes: the source of a formula the file says
// is a formula.
describe('a display formula survives the blank lines inside it', () => {
  test.each([
    ['one blank line', '$$\\begin{aligned}\na &= 1\\\\\n\nb &= 2\n\\end{aligned}$$'],
    ['several', '$$\na\n\nb\n\nc\n$$'],
    ['after prose, with no blank line between', 'Before it\n$$\na\n\nb\n$$'],
  ])('%s', (_name, md) => {
    expect(html(md)).toContain('data-mode="display"');
    expect(html(md)).not.toContain('$$');
  });

  test('the whole formula reaches the typesetter, blank line and all', () => {
    const { math } = renderer().render('$$\na\n\nb\n$$');
    expect([...math.entries.values()]).toEqual([{ latex: 'a\n\nb', display: true }]);
  });

  test('a formula in the middle of a sentence is still one', () => {
    expect(html('text $$x+y$$ text')).toContain('data-mode="display">x+y<');
  });

  test.each([
    ['a fence', '```sh\necho $PATH\n$$x$$\n```'],
    ['a code span', 'Use `$$x$$` literally'],
    ['an indented block', '    $$x$$'],
  ])('%s is opaque to the block tokenizer too', (_name, md) => {
    expect(html(md)).not.toContain('class="katex"');
  });

  // The first `$$` after the opener closes it and has to be the last thing on its
  // line: a second formula further down must not be reachable by the first
  // opener, with the prose between the two swallowed into the LaTeX.
  test('a stray pair of dollars does not swallow the note', () => {
    expect(text('$$a$$ and prose\n$$b$$')).toContain('and prose');
  });
});

// The hydrator took every `[data-katex]` in the container and looked its id up in
// a map keyed `0`, `1`, `2`. A note is edited by hand and `marked` passes its
// markup through.
describe('the placeholders belong to one render', () => {
  test('a hand-written data-katex keeps its own text', () => {
    const out = mounted('<span data-katex="0">KEEP</span> and $x$');
    expect(out.textContent).toContain('KEEP');
    expect(out.innerHTML).toContain('data-mode="inline">x<');
  });

  test('the ids of two renders do not collide', () => {
    const one = renderer();
    const a = one.render('$x$');
    const b = one.render('$y$');
    expect([...a.math.entries.keys()]).not.toEqual([...b.math.entries.keys()]);
  });

  // The result owns its formulas: a second render used to empty the first one's,
  // which a reader saw as a preview mounted from a document that no longer had
  // any maths in it.
  test('a second render does not empty the first one', () => {
    const one = renderer();
    const first = one.render('$x$');
    one.render('$y$');
    one.mount(container, first);
    expect(container.innerHTML).toContain('data-mode="inline">x<');
  });

  test('a result can be mounted twice, into two documents', () => {
    const one = renderer();
    const result = one.render('$x$');
    const second = win.document.createElement('div') as unknown as Element;
    one.mount(container, result);
    one.mount(second, result);
    expect(second.innerHTML).toContain('data-mode="inline">x<');
  });

  test('the id cannot be guessed from the note', () => {
    const { math } = renderer().render('$x$');
    const id = [...math.entries.keys()][0]!;
    expect(id).toMatch(/^[0-9a-f]{16}-\d+$/);
  });

  // The hydrator is exported for a caller who mounts markup themselves, and it is
  // the same code the renderer runs: two spellings of "which spans are mine"
  // would be one spelling too many.
  test('the hydrator finds the placeholders of one render and no others', () => {
    const result = renderer().render('$x$');
    container.innerHTML = `<span data-katex="0"></span>${result.html}`;
    hydrateMath(container, result.math, (latex) => `<i>${latex}</i>`);
    expect(container.innerHTML).toContain('<i>x</i>');
    expect(container.innerHTML).toContain('<span data-katex="0"></span>');
  });
});

import { describe, test, expect } from 'bun:test';
import { Marked } from 'marked';
import {
  createMarkdownRenderer,
  headingSlug,
  type KatexEngine,
  type MarkdownRenderer,
  type RendererOptions,
} from '../src/index.js';

const katex: KatexEngine = {
  renderToString: (latex, options) =>
    `<span class="katex" data-mode="${options.displayMode ? 'display' : 'inline'}">${latex}</span>`,
};

const asIs = (html: string) => html;

function renderer(overrides: Partial<RendererOptions> = {}): MarkdownRenderer {
  return createMarkdownRenderer({
    Marked: Marked as unknown as RendererOptions['Marked'],
    sanitize: asIs,
    katex,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// headingSlug — pure, no renderer, no state
// ---------------------------------------------------------------------------

describe('headingSlug', () => {
  test('ordinary Latin text becomes a lowercased hyphenated id', () => {
    expect(headingSlug('Hello World')).toBe('hello-world');
  });

  test('empty text is empty — the renderer, not the slug, invents a base', () => {
    expect(headingSlug('')).toBe('');
    expect(headingSlug('   ')).toBe('');
  });

  test('punctuation-only is empty', () => {
    expect(headingSlug('!!!')).toBe('');
    expect(headingSlug('— – ·')).toBe('');
  });

  test('emoji-only is empty', () => {
    expect(headingSlug('🎉')).toBe('');
    expect(headingSlug('✨🌟')).toBe('');
  });

  // Cyrillic is the case the consumer will hit first: a Russian document whose
  // headings were stripped to empty would get every anchor as `heading`,
  // `heading-1`, … and every in-article link would point at the wrong place.
  test('Cyrillic letters are kept, not stripped to empty', () => {
    expect(headingSlug('Заголовок')).toBe('заголовок');
    expect(headingSlug('Глава 1. Введение')).toBe('глава-1-введение');
  });

  test('CJK letters are kept', () => {
    expect(headingSlug('标题')).toBe('标题');
    expect(headingSlug('第一章 介绍')).toBe('第一章-介绍');
  });

  // Callers (and tests) may pass text that still holds Markdown markers; they
  // are punctuation and fall out. The renderer itself passes plain text.
  test('inline markup characters do not survive into the id', () => {
    expect(headingSlug('The *hard* case')).toBe('the-hard-case');
    expect(headingSlug('A `code` span')).toBe('a-code-span');
  });

  test('a formula is letters and symbols: symbols become hyphens', () => {
    expect(headingSlug('Title x^2')).toBe('title-x-2');
    expect(headingSlug('E=mc^2')).toBe('e-mc-2');
  });

  test('same input always yields the same output', () => {
    expect(headingSlug('Intro')).toBe(headingSlug('Intro'));
    expect(headingSlug('Заголовок')).toBe(headingSlug('Заголовок'));
  });

  test('leading and trailing separators fall off; runs collapse', () => {
    expect(headingSlug('  Hello   World  ')).toBe('hello-world');
    expect(headingSlug('---Hello---')).toBe('hello');
  });
});

// ---------------------------------------------------------------------------
// headingIds off — the default path is the path that already shipped
// ---------------------------------------------------------------------------

describe('headingIds off (default)', () => {
  // Not "the option is false" — the markup itself must match, byte for byte,
  // what a renderer without the option ever produced. The clipper's preview
  // panel depends on that. (Formulas are compared after the per-render token is
  // blanked: those ids are random by design and would make every comparison
  // fail for a reason that has nothing to do with headings.)
  test('the markup is identical to a renderer that never heard of the option', () => {
    const samples = [
      '# Title\n\n## Sub\n\nparagraph',
      '## The *hard* case\n\nbody',
      '# Title\n\n# Title\n\n### Other',
      '> ## quoted heading\n\ntext',
      '# Заголовок\n\nтекст',
      '## Title $x^2$\n\nbody',
      '# \n\nempty-ish',
    ];
    const blankMath = (html: string) => html.replace(/data-katex="[^"]*"/g, 'data-katex=""');
    const withDefault = renderer();
    const withExplicitOff = renderer({ headingIds: false });
    // A second instance, no headingIds key at all — what every caller today is.
    const legacy = createMarkdownRenderer({
      Marked: Marked as unknown as RendererOptions['Marked'],
      sanitize: asIs,
      katex,
    });

    for (const md of samples) {
      const expected = legacy.render(md).html;
      expect(blankMath(withDefault.render(md).html)).toBe(blankMath(expected));
      expect(blankMath(withExplicitOff.render(md).html)).toBe(blankMath(expected));
      // And no id attributes slipped in on any heading.
      expect(expected).not.toMatch(/<h[1-6][^>]*\sid=/);
      expect(withDefault.render(md).html).not.toMatch(/<h[1-6][^>]*\sid=/);
    }
  });

  test('the heading list is empty — nothing to agree with', () => {
    const result = renderer().render('# Title\n\n## Sub');
    expect(result.headings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// headingIds on — ids, list, uniqueness
// ---------------------------------------------------------------------------

describe('headingIds on', () => {
  test('every heading carries an id, and the list matches the markup', () => {
    const { html, headings } = renderer({ headingIds: true }).render(
      '# Alpha\n\n## Beta\n\n### Gamma',
    );
    expect(headings).toEqual([
      { level: 1, text: 'Alpha', id: 'alpha' },
      { level: 2, text: 'Beta', id: 'beta' },
      { level: 3, text: 'Gamma', id: 'gamma' },
    ]);
    for (const h of headings) {
      expect(html).toContain(`<h${h.level} id="${h.id}">`);
    }
  });

  test('a repeated heading is unique within one render', () => {
    const { html, headings } = renderer({ headingIds: true }).render(
      '# Title\n\n# Title\n\n# Title',
    );
    expect(headings.map((h) => h.id)).toEqual(['title', 'title-1', 'title-2']);
    expect(html).toContain('<h1 id="title">');
    expect(html).toContain('<h1 id="title-1">');
    expect(html).toContain('<h1 id="title-2">');
  });

  // The counter is per render: render the same document twice and both copies
  // start at `title`, not at whatever the first render left behind.
  test('a second render of the same note does not continue the counter', () => {
    const one = renderer({ headingIds: true });
    const first = one.render('# Title\n\n# Title');
    const second = one.render('# Title\n\n# Title');
    expect(first.headings.map((h) => h.id)).toEqual(['title', 'title-1']);
    expect(second.headings.map((h) => h.id)).toEqual(['title', 'title-1']);
    expect(first.html).toBe(second.html);
  });

  test('two separate renderers do not share a counter either', () => {
    const a = renderer({ headingIds: true }).render('# Title');
    const b = renderer({ headingIds: true }).render('# Title');
    expect(a.headings[0]!.id).toBe('title');
    expect(b.headings[0]!.id).toBe('title');
  });

  test('Cyrillic heading text becomes a Cyrillic id', () => {
    const { html, headings } = renderer({ headingIds: true }).render('# Введение');
    expect(headings).toEqual([{ level: 1, text: 'Введение', id: 'введение' }]);
    expect(html).toContain('<h1 id="введение">');
  });

  test('inline markup leaves plain text in the list and in the id', () => {
    const { html, headings } = renderer({ headingIds: true }).render(
      '## The *hard* case',
    );
    expect(headings).toEqual([{ level: 2, text: 'The hard case', id: 'the-hard-case' }]);
    expect(html).toContain('<h2 id="the-hard-case">');
    expect(html).toContain('<em>hard</em>');
  });

  test('a link in a heading contributes its label, not its URL', () => {
    const { headings } = renderer({ headingIds: true }).render(
      '## See [the docs](https://example.com/path) now',
    );
    expect(headings).toEqual([
      { level: 2, text: 'See the docs now', id: 'see-the-docs-now' },
    ]);
  });

  // Maths travel as empty placeholders until after the sanitizer. Letting that
  // placeholder into the id or the list would give a reader an empty fragment of
  // the heading and an id no live-page text will ever reproduce.
  test('a formula in a heading contributes its LaTeX, never the placeholder', () => {
    const { html, headings } = renderer({ headingIds: true }).render('## Title $x^2$');
    expect(headings).toHaveLength(1);
    expect(headings[0]!.text).toBe('Title x^2');
    expect(headings[0]!.id).toBe('title-x-2');
    expect(headings[0]!.text).not.toContain('data-katex');
    expect(headings[0]!.id).not.toContain('data-katex');
    expect(html).toContain(`id="${headings[0]!.id}"`);
    expect(html).toContain('data-katex=');
  });

  test('an empty heading still gets a stable id', () => {
    const { html, headings } = renderer({ headingIds: true }).render('# \n\nbody');
    expect(headings).toEqual([{ level: 1, text: '', id: 'heading' }]);
    expect(html).toContain('<h1 id="heading">');
  });

  test('punctuation-only headings share the empty base and uniquify', () => {
    const { headings } = renderer({ headingIds: true }).render('# !!!\n\n# !!!');
    expect(headings.map((h) => h.id)).toEqual(['heading', 'heading-1']);
  });

  // The ids ride through sanitize with the rest of the document. A consumer that
  // strips `id` will break the list↔markup agreement; default allow-through is
  // what this pins.
  test('ids survive a sanitizer that passes markup through', () => {
    let seen = '';
    const { html, headings } = renderer({
      headingIds: true,
      sanitize: (h) => {
        seen = h;
        return h;
      },
    }).render('# Title');
    expect(seen).toContain('id="title"');
    expect(html).toContain('id="title"');
    expect(headings[0]!.id).toBe('title');
  });

  test('a heading inside a blockquote is collected too', () => {
    const { html, headings } = renderer({ headingIds: true }).render(
      '> ## Quoted\n\n# Outer',
    );
    expect(headings.map((h) => h.id)).toEqual(['quoted', 'outer']);
    expect(html).toContain('<h2 id="quoted">');
    expect(html).toContain('<h1 id="outer">');
  });
});

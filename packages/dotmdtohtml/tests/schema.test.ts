/**
 * The document a theme is written against.
 *
 * A stylesheet is code that runs against markup it did not write, with no
 * compiler between the two: a class that quietly stops being emitted takes a rule
 * with it and leaves a document that is merely wrong, which is the failure this
 * whole layer exists to stop happening again. Every name the schema declares is
 * pinned here to the markup that carries it, and the stylesheets are pinned to
 * the manifest that names them.
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Window } from 'happy-dom';
import { Marked } from 'marked';
import {
  createMarkdownRenderer,
  DOTMD_BASE_STYLESHEET,
  DOTMD_CLASS,
  DOTMD_SCHEMA_ATTR,
  DOTMD_SCHEMA_VERSION,
  DOTMD_THEMES,
  type KatexEngine,
  type MarkdownRenderer,
  type RendererOptions,
} from '../src/index.js';

const packageRoot = new URL('..', import.meta.url).pathname;

let win: Window;
let container: Element;

beforeEach(() => {
  win = new Window();
  const div = win.document.createElement('div');
  win.document.body.appendChild(div);
  container = div as unknown as Element;
});

const katex: KatexEngine = {
  renderToString: (latex, options) =>
    `<span class="katex" data-mode="${options.displayMode ? 'display' : 'inline'}">${latex}</span>`,
};

function renderer(overrides: Partial<RendererOptions> = {}): MarkdownRenderer {
  return createMarkdownRenderer({
    Marked: Marked as unknown as RendererOptions['Marked'],
    sanitize: (html: string) => html,
    katex,
    ...overrides,
  });
}

function markup(md: string): string {
  return renderer().render(md).html;
}

describe('the classes the renderer writes', () => {
  // A span is inline, and nothing else in the markup says this one stood on a
  // line of its own — the product's CSS used to ask a private `data-display`
  // attribute, which is a schema nobody declared.
  test('a display formula is marked as one', () => {
    const out = markup('a\n\n$$x+y$$\n\nb');
    expect(out).toContain(`class="${DOTMD_CLASS.math} ${DOTMD_CLASS.mathDisplay}"`);
    expect(out).not.toContain(DOTMD_CLASS.mathInline);
  });

  test('an inline formula is marked as one', () => {
    const out = markup('cost $x$ each');
    expect(out).toContain(`class="${DOTMD_CLASS.math} ${DOTMD_CLASS.mathInline}"`);
    expect(out).not.toContain(DOTMD_CLASS.mathDisplay);
  });

  // The hydrator drops `data-katex` once the formula is drawn; the class has to
  // survive that, because the rule that makes the formula a block is on it.
  test('a drawn display formula keeps its class', () => {
    renderer().renderInto(container, '$$x$$');
    const span = container.querySelector(`.${DOTMD_CLASS.mathDisplay}`);
    expect(span).not.toBeNull();
    expect(span!.getAttribute('data-katex')).toBeNull();
    expect(span!.innerHTML).toContain('data-mode="display"');
  });

  test('a task item says it is one, and whether it is done', () => {
    const out = markup('- [ ] open\n- [x] done');
    expect(out).toContain(`<li class="${DOTMD_CLASS.task}">`);
    expect(out).toContain(`<li class="${DOTMD_CLASS.task} ${DOTMD_CLASS.taskDone}">`);
  });

  // The override is only allowed to add the name. The checkbox `marked` writes,
  // and the content beside it, must arrive unchanged.
  test('an ordinary item is left alone', () => {
    const out = markup('- plain');
    expect(out).toContain('<li>plain</li>');
    expect(out).not.toContain(DOTMD_CLASS.task);
  });

  test('a task item still carries its checkbox', () => {
    renderer().renderInto(container, '- [x] done');
    const item = container.querySelector(`li.${DOTMD_CLASS.task}`)!;
    expect(item.querySelector('input[type="checkbox"]')).not.toBeNull();
    expect(item.textContent).toContain('done');
  });

  test('the blank lines a page left are a class, not a word', () => {
    expect(markup('a\n\n\n\nb')).toContain(`<div class="${DOTMD_CLASS.contentGap}"></div>`);
  });

  // A highlight is a `<mark>` and a heading is an `<h2>`: the schema adds a name
  // only where the element cannot say what it is, and a second name for
  // something that already has one is a second thing to keep in step.
  test('a native element is left to say what it is', () => {
    const out = markup('a ==marked== b\n\n## heading\n\n> quoted');
    expect(out).toContain('<mark>marked</mark>');
    expect(out).not.toContain('dotmd-mark');
    expect(out).not.toContain('dotmd-heading');
  });
});

describe('the document root', () => {
  test('mounting marks the element as the document', () => {
    renderer().renderInto(container, 'text');
    expect(container.classList.contains(DOTMD_CLASS.root)).toBe(true);
    expect(container.getAttribute(DOTMD_SCHEMA_ATTR)).toBe(String(DOTMD_SCHEMA_VERSION));
  });

  // The consumer's own classes on that element are its business: the root is
  // handed over by a product that may have named it something too.
  test('the element keeps the classes it arrived with', () => {
    container.className = 'product-owned';
    renderer().renderInto(container, 'text');
    expect(container.classList.contains('product-owned')).toBe(true);
    expect(container.classList.contains(DOTMD_CLASS.root)).toBe(true);
  });

  test('a second mount does not add the class twice', () => {
    const one = renderer();
    one.renderInto(container, 'a');
    one.renderInto(container, 'b');
    expect(container.className.split(/\s+/).filter((c) => c === DOTMD_CLASS.root)).toHaveLength(1);
  });
});

/**
 * The stylesheets are three separate declarations — a file on disk, a line in
 * the manifest, a subpath in `package.json` — and nothing but this compares
 * them. `pack-exports.ts` asks the fourth question, of the tarball, because that
 * one cannot be asked from here.
 */
describe('the stylesheets this package ships', () => {
  const specifier = (name: string): string => name.replace(/^dotmdtohtml\//, './');

  interface Manifest {
    exports: Record<string, unknown>;
  }

  const manifest = async (): Promise<Manifest> =>
    (await Bun.file(join(packageRoot, 'package.json')).json()) as Manifest;

  test('the base sheet exists, is exported and declares the layer order', async () => {
    const file = Bun.file(join(packageRoot, 'styles/base.css'));
    expect(await file.exists()).toBe(true);
    const css = await file.text();
    expect(css).toContain('@layer dotmd.host, dotmd.base, dotmd.theme, dotmd.product;');
    expect(Object.keys((await manifest()).exports)).toContain(specifier(DOTMD_BASE_STYLESHEET));
  });

  test.each(DOTMD_THEMES.map((theme) => [theme.id, theme.stylesheet] as const))(
    'the %s theme has a file and a subpath',
    async (_id, stylesheet) => {
      const relative = specifier(stylesheet).replace('./', 'styles/');
      expect(await Bun.file(join(packageRoot, relative)).exists()).toBe(true);
      expect(Object.keys((await manifest()).exports)).toContain(specifier(stylesheet));
    },
  );

  // The other direction, which is the one that rots: a theme added to `styles/`
  // and left out of the manifest is a theme no product can offer, and nothing
  // else would ever mention it.
  test('every theme file is in the manifest', async () => {
    const files = (await readdir(join(packageRoot, 'styles/themes')))
      .filter((name) => name.endsWith('.css'))
      .sort();
    const named = DOTMD_THEMES.map((theme) => theme.stylesheet.split('/').pop()!).sort();
    expect(files).toEqual(named);
  });

  test('a theme adds to the base sheet rather than replacing it', async () => {
    for (const theme of DOTMD_THEMES) {
      const relative = specifier(theme.stylesheet).replace('./', 'styles/');
      const css = await Bun.file(join(packageRoot, relative)).text();
      // Everything a theme says is inside the theme layer, or the cascade the
      // base sheet declares is not the cascade that runs.
      expect(css).toContain('@layer dotmd.theme {');
      expect(css).not.toContain('@layer dotmd.base');
      // The three rules a document is wrong without belong to the base sheet.
      // A theme may move the spacing token; the rule itself is not its to write.
      expect(css).not.toContain('display: block');
      expect(css).not.toContain('list-style-type: none');
    }
  });

  // Both halves of the light/dark contract, in every theme: one theme with two
  // palettes rather than two themes, and a product that has decided beats the
  // operating system that guessed.
  test.each(DOTMD_THEMES.map((theme) => [theme.id, theme.stylesheet] as const))(
    'the %s theme carries both schemes and lets a product force one',
    async (_id, stylesheet) => {
      const relative = specifier(stylesheet).replace('./', 'styles/');
      const css = await Bun.file(join(packageRoot, relative)).text();
      expect(css).toContain('@media (prefers-color-scheme: dark)');
      expect(css).toContain("[data-dotmd-color-scheme='dark']");
      expect(css).toContain("[data-dotmd-color-scheme='light']");
      // The forced palettes are written after the query, so they win on source
      // order as well as on specificity.
      expect(css.indexOf("[data-dotmd-color-scheme='dark']")).toBeGreaterThan(
        css.indexOf('@media (prefers-color-scheme: dark)'),
      );
    },
  );
});

/**
 * The token contract, held from three sides.
 *
 * `base.css` declares the vocabulary and derives the root's properties from it;
 * `schema.ts` exports the names so a program touches them through the compiler
 * rather than through strings; a theme spends tokens and never overwrites the
 * properties they feed. The third side is the one that failed in the field:
 * `paper` wrote `line-height: 1.7` outright, the theme layer outranks base, and
 * `--dotmd-line-height` became a knob that turned nothing — a consumer grew an
 * inline-style workaround with this stylesheet's number in a comment before
 * anyone noticed the token was dead.
 *
 * The scanner below is deliberately not a regex over `.dotmd-doc {`: a theme
 * restates the root as `.dotmd-doc[data-dotmd-color-scheme='dark']`, as
 * `:root[…] .dotmd-doc`, and inside `@media` — the first draft saw none of
 * those, which let `line-height: 2` into a dark block with every test green.
 */
import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DOTMD_TOKENS } from '../src/schema.js';
import {
  DOTMD_BASE_STYLESHEET,
  DOTMD_STYLESHEET_SPECIFIER_PREFIX,
  DOTMD_THEMES,
} from '../src/themes.js';

const stylesDir = join(import.meta.dir, '..', 'styles');

/**
 * Comments go first: prose in these files quotes declarations — including the
 * very `line-height: 1.7` this suite exists to keep out — and a quotation is
 * not a declaration.
 */
function readCss(name: string): string {
  return readFileSync(join(stylesDir, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/**
 * Every innermost declaration block as a `{ selector, body }` pair.
 *
 * A small stack walk rather than a block regex, for two reasons the stylesheets
 * already exercise: rules nest under `@media` and `@layer`, and a string value
 * may hold a brace (`content: "}"`) that a `[^}]*` would trip on. Quotes are
 * skipped as units; at-rule preludes are pushed like selectors and discarded
 * when their frame closes with no declarations of its own. CSS nesting inside a
 * declaration block is not handled — nothing here writes it.
 */
function declarationBlocks(css: string): Array<{ selector: string; body: string }> {
  const out: Array<{ selector: string; body: string }> = [];
  const stack: string[] = [];
  let buf = '';
  for (let i = 0; i < css.length; i += 1) {
    const ch = css[i]!;
    if (ch === '"' || ch === "'") {
      buf += ch;
      i += 1;
      while (i < css.length && css[i] !== ch) {
        if (css[i] === '\\') {
          buf += css[i]!;
          i += 1;
        }
        if (i < css.length) {
          buf += css[i]!;
          i += 1;
        }
      }
      if (i < css.length) buf += css[i]!;
      continue;
    }
    if (ch === '{') {
      stack.push(buf.trim());
      buf = '';
      continue;
    }
    if (ch === '}') {
      const selector = stack.pop();
      const body = buf.trim();
      if (selector !== undefined && selector !== '' && body !== '' && !selector.startsWith('@')) {
        out.push({ selector, body });
      }
      buf = '';
      continue;
    }
    buf += ch;
  }
  return out;
}

/**
 * Whether any selector in the list styles the document root itself.
 *
 * The subject is the rightmost compound: `.dotmd-doc`, with or without
 * attribute selectors and pseudo-classes, reached directly or through a
 * descendant prefix (`:root[…] .dotmd-doc`). A pseudo-element
 * (`.dotmd-doc::before`) is not the root — its declarations land on a box of
 * their own. A comma inside `:is(…)` splits the list wrong, harmlessly: the
 * fragments it produces match nothing.
 */
function targetsRoot(selectorList: string): boolean {
  return selectorList.split(',').some((selector) => {
    const compounds = selector.trim().split(/[\s>+~]+/);
    const subject = compounds[compounds.length - 1] ?? '';
    return /^\.dotmd-doc(\[[^\]]*\]|:[a-z-]+(\([^)]*\))?)*$/.test(subject);
  });
}

/** Declaration bodies of every block that styles the root. */
function rootBodies(css: string): string[] {
  return declarationBlocks(css)
    .filter((block) => targetsRoot(block.selector))
    .map((block) => block.body);
}

function propertiesOf(body: string): string[] {
  return [...body.matchAll(/(?:^|;)\s*([a-z][a-z-]*)\s*:/g)].map((m) => m[1]!);
}

const base = readCss('base.css');

/**
 * What base derives from a token on the root — font-family, line-height and
 * the rest — read off the stylesheet itself, so a property added to the
 * derivation is guarded without editing this file.
 */
const derived = new Set(
  rootBodies(base).flatMap((body) =>
    [...body.matchAll(/(?:^|;)\s*([a-z-]+)\s*:\s*var\(--dotmd-/g)].map((m) => m[1]!),
  ),
);

/** The offence list for one stylesheet: derived properties written on the root. */
function bypassedIn(css: string): string[] {
  return rootBodies(css).flatMap((body) => propertiesOf(body).filter((p) => derived.has(p)));
}

describe('the token vocabulary', () => {
  test('schema.ts and base.css state the same set, both directions', () => {
    const declared = [...new Set([...base.matchAll(/(--dotmd-[a-z0-9-]+)\s*:/g)].map((m) => m[1]!))];
    const exported: string[] = Object.values(DOTMD_TOKENS);
    // Sorted, so a failure names the one that drifted instead of dumping both
    // lists as unequal.
    expect([...exported].sort()).toEqual(declared.sort());
  });

  test('a theme spends tokens on the root, never the properties they feed', () => {
    expect(derived.size).toBeGreaterThan(3);
    for (const theme of DOTMD_THEMES) {
      const relative = theme.stylesheet.slice(DOTMD_STYLESHEET_SPECIFIER_PREFIX.length);
      // Naming the theme in the assertion the cheap way: as data.
      expect({ theme: theme.id, bypassed: bypassedIn(readCss(relative)) }).toEqual({
        theme: theme.id,
        bypassed: [],
      });
    }
  });

  test('every stylesheet specifier starts with the exported prefix', () => {
    // The prefix is what a consumer that ships styles/ at a root of its own
    // strips; a specifier that does not start with it would slice into garbage.
    expect(DOTMD_BASE_STYLESHEET.startsWith(DOTMD_STYLESHEET_SPECIFIER_PREFIX)).toBe(true);
    for (const theme of DOTMD_THEMES) {
      expect(theme.stylesheet.startsWith(DOTMD_STYLESHEET_SPECIFIER_PREFIX)).toBe(true);
    }
  });
});

describe('the scanner the contract stands on', () => {
  // Each case is a way the first draft was blind, kept as a regression fence.
  test('sees the root behind an attribute selector inside @media', () => {
    const css =
      "@media (prefers-color-scheme: dark) { .dotmd-doc[data-dotmd-color-scheme='dark'] { line-height: 2; } }";
    expect(bypassedIn(css)).toEqual(['line-height']);
  });

  test('sees the root as the subject of a descendant selector, and in a list', () => {
    const css = ":root[data-dotmd-color-scheme='dark'] .dotmd-doc, .dotmd-doc[x] { color: red; }";
    expect(bypassedIn(css)).toEqual(['color']);
  });

  test('does not flag a child of the root, nor a pseudo-element', () => {
    const css =
      '.dotmd-doc h2 { line-height: 2; } .dotmd-doc :is(h1, h2) { line-height: 2; } ' +
      '.dotmd-doc::before { color: red; }';
    expect(bypassedIn(css)).toEqual([]);
  });

  test('a brace inside a string does not derail the walk', () => {
    const css = '.dotmd-doc h2::before { content: "}"; } .dotmd-doc { line-height: 2; }';
    expect(bypassedIn(css)).toEqual(['line-height']);
  });

  test('still catches the exact form paper shipped', () => {
    // The field case, verbatim: a bare declaration in the plain root block.
    const css = '@layer dotmd.theme { .dotmd-doc { --dotmd-radius: 2px; line-height: 1.7; } }';
    expect(bypassedIn(css)).toEqual(['line-height']);
  });
});

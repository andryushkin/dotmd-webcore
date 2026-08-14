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
 * skipped as units; a statement at-rule (`@layer a, b;`, `@import …;`) is
 * dropped at its semicolon so the selector after it starts clean; grouping
 * at-rule preludes are pushed like selectors and discarded when their frame
 * closes with no declarations of its own.
 *
 * CSS nesting is refused rather than not handled: a block popped while a
 * *style rule* still sits on the stack is a rule nested inside a declaration
 * block, this walk cannot attribute its declarations, and a guard that goes
 * silently blind on valid CSS is the defect the second review draft had. The
 * throw turns the whole suite red, which is the fail-closed answer.
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
    if (ch === ';' && buf.trimStart().startsWith('@')) {
      // `@layer dotmd.theme;` and its kin end here, not at a brace. Kept in
      // buf, it used to glue itself onto the next selector, whose block then
      // read as an at-rule and was discarded — declarations and all.
      buf = '';
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
      if (selector !== undefined && selector !== '' && body !== '') {
        if (stack.some((outer) => !outer.startsWith('@'))) {
          throw new Error(
            `CSS nesting under a style rule is not supported by this scanner: "${selector}" inside "${stack.join(' > ')}"`,
          );
        }
        if (!selector.startsWith('@')) {
          out.push({ selector, body });
        }
      }
      buf = '';
      continue;
    }
    buf += ch;
  }
  return out;
}

/**
 * Splits on the given separator only at bracket depth zero, so a comma inside
 * `:is(…)` and a space inside `[data-label="a b"]` do not shear a selector.
 * Quoted content never reaches here with structure the depth count would
 * misread: attribute strings hold no brackets in these files.
 */
function splitTop(text: string, isSeparator: (ch: string) => boolean): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '(' || ch === '[') depth += 1;
    else if (ch === ')' || ch === ']') depth -= 1;
    if (depth === 0 && isSeparator(ch)) {
      if (current.trim() !== '') parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim() !== '') parts.push(current.trim());
  return parts;
}

/**
 * Whether any selector in the list styles the document root itself.
 *
 * The subject is the rightmost compound: `.dotmd-doc`, with or without
 * attribute selectors and pseudo-classes (arguments included, so
 * `.dotmd-doc:is([data-a], [data-b])` is the root too), reached directly or
 * through a descendant prefix (`:root[…] .dotmd-doc`). A pseudo-element
 * (`.dotmd-doc::before`) is not the root — its declarations land on a box of
 * their own.
 */
function targetsRoot(selectorList: string): boolean {
  return splitTop(selectorList, (ch) => ch === ',').some((selector) => {
    const compounds = splitTop(selector, (ch) => /[\s>+~]/.test(ch));
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
  // Strings are blanked first: a custom property may legally hold
  // `"; line-height: 2"` as its value, and a property name fished out of a
  // string would fail the suite on innocent CSS.
  const noStrings = body.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
  return [...noStrings.matchAll(/(?:^|;)\s*([a-z][a-z-]*)\s*:/g)].map((m) => m[1]!);
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

  // The second review round: four valid spellings the first scanner let
  // through silently, and one it would have flagged on innocent CSS.
  test('a statement at-rule does not glue itself onto the next selector', () => {
    const css = '@layer dotmd.theme; .dotmd-doc { line-height: 2; }';
    expect(bypassedIn(css)).toEqual(['line-height']);
  });

  test('a comma inside :is() does not shear the subject', () => {
    const css = '.dotmd-doc:is([data-a], [data-b]) { line-height: 2; }';
    expect(bypassedIn(css)).toEqual(['line-height']);
  });

  test('a space inside an attribute string does not shear the subject', () => {
    const css = '.dotmd-doc[data-label="a b"] { line-height: 2; }';
    expect(bypassedIn(css)).toEqual(['line-height']);
  });

  test('CSS nesting fails the suite instead of hiding a violation', () => {
    // The scanner cannot attribute nested declarations; refusing loudly is the
    // fail-closed answer — a theme that adopts nesting must first teach the
    // guard to read it.
    const css = '.dotmd-doc { @media (width > 1px) { line-height: 2; } }';
    expect(() => bypassedIn(css)).toThrow('CSS nesting');
  });

  test('a property name inside a string value is not a declaration', () => {
    const css = '.dotmd-doc { --example: "; line-height: 2"; }';
    expect(bypassedIn(css)).toEqual([]);
  });
});

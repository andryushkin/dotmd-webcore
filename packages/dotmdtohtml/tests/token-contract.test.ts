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

const base = readCss('base.css');

/** Declaration bodies of blocks whose selector is exactly `.dotmd-doc`. */
function rootBlocks(css: string): string[] {
  return [...css.matchAll(/(?:^|[{};])\s*\.dotmd-doc\s*\{([^}]*)\}/g)].map((m) => m[1]!);
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
    // What base derives from a token on the root — font-family, line-height and
    // the rest — read off the stylesheet itself, so a property added to the
    // derivation is guarded without editing this file.
    const derived = new Set(
      rootBlocks(base).flatMap((block) =>
        [...block.matchAll(/(?:^|;)\s*([a-z-]+)\s*:\s*var\(--dotmd-/g)].map((m) => m[1]!),
      ),
    );
    expect(derived.size).toBeGreaterThan(3);

    for (const theme of DOTMD_THEMES) {
      const relative = theme.stylesheet.slice(DOTMD_STYLESHEET_SPECIFIER_PREFIX.length);
      const css = readCss(relative);
      const blocks = rootBlocks(css);
      expect(blocks.length).toBeGreaterThan(0);
      for (const block of blocks) {
        const properties = [...block.matchAll(/(?:^|;)\s*([a-z][a-z-]*)\s*:/g)].map((m) => m[1]!);
        const bypassed = properties.filter((p) => derived.has(p));
        // Naming the theme in the assertion message the cheap way: as data.
        expect({ theme: theme.id, bypassed }).toEqual({ theme: theme.id, bypassed: [] });
      }
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

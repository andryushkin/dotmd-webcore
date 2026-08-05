import { defineConfig } from 'tsup';

/**
 * Two entries, two subpaths, and nothing external.
 *
 * The sibling package's build has a boundary to repair — it imports the
 * converter by relative path and those paths have to become package specifiers
 * on the way out. This one has no such import: `marked`, DOMPurify and KaTeX
 * arrive as arguments, so nothing crosses and there is nothing to rewrite.
 *
 * Every entry here is a subpath in `package.json`, and every subpath there is an
 * entry here. Halves of one declaration: a name in `exports` alone resolves to a
 * file the build never wrote, and `scripts/pack-exports.ts` is what says so out
 * loud — it packs the tarball and imports each subpath out of it.
 */
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'plain-text': 'src/plain-text.ts',
  },
  format: ['esm'],
  outExtension: () => ({ js: '.mjs' }),
  dts: true,
  outDir: 'dist',
  platform: 'browser',
  minify: true,
});

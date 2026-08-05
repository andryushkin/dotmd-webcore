import { defineConfig } from 'tsup';

/**
 * Two entries, five subpaths, and nothing external.
 *
 * The sibling package's build has a boundary to repair — it imports the
 * converter by relative path and those paths have to become package specifiers
 * on the way out. This one has no such import: `marked`, DOMPurify and KaTeX
 * arrive as arguments, so nothing crosses and there is nothing to rewrite.
 *
 * Every subpath in `package.json` is written here — the two JavaScript ones as
 * entries, the three stylesheets by `publicDir`, which copies `styles/` into
 * `dist/` verbatim. A stylesheet is not compiled and must not be: it is read by
 * a browser, and a rule this build "helpfully" rewrote would be a rule the
 * source no longer states. `files` ships `dist`, so the copy is what a consumer
 * installs.
 *
 * Halves of one declaration, either way: a name in `exports` alone resolves to a
 * file the build never wrote, and `scripts/pack-exports.ts` is what says so out
 * loud — it packs the tarball and looks for every subpath inside it.
 */
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'plain-text': 'src/plain-text.ts',
  },
  publicDir: 'styles',
  format: ['esm'],
  outExtension: () => ({ js: '.mjs' }),
  dts: true,
  outDir: 'dist',
  platform: 'browser',
  minify: true,
});

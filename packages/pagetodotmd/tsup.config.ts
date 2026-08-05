import { defineConfig } from 'tsup';

/**
 * The published shape of a package whose source imports its neighbour by
 * relative path.
 *
 * Inside this repository the two packages are read from source — the extensions
 * vendor it as a submodule and `bun build` inlines the TypeScript, with no
 * `node_modules` in the way — so `src/engine.ts` names the converter by the path
 * it sits at, and that is the only file allowed to. Bundling those paths
 * literally would inline the whole converter into this package's `dist/`, and a
 * consumer installing both would ship two copies of it, disagreeing the moment
 * their versions did.
 *
 * So the three are marked external and rewritten afterwards
 * (`scripts/publish-paths.ts`) into the public subpaths they stand for. There is
 * still one list of what crosses the boundary — `src/engine.ts` — and this is the
 * map from it; nothing else in this package may cross, which is what keeps the
 * map three entries long. The rewrite refuses to finish if a fourth path reached
 * `dist/` without an entry here.
 */
export const BOUNDARY: Record<string, string> = {
  '../../htmltodotmd/src/browser.js': 'htmltodotmd',
  '../../htmltodotmd/src/selection.js': 'htmltodotmd/selection',
  '../../htmltodotmd/src/snapshot.js': 'htmltodotmd/snapshot',
};

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    text: 'src/text.ts',
  },
  format: ['esm'],
  outExtension: () => ({ js: '.mjs' }),
  // The type build is a different tool — `rollup-plugin-dts` — and `resolve:
  // false` is what stops it copying the converter's declarations in wholesale:
  // 36 KB of a neighbour's types under this package's name, free to drift the
  // moment the two versions did.
  dts: { resolve: false },
  external: Object.keys(BOUNDARY),
  outDir: 'dist',
  platform: 'browser',
  minify: true,
});

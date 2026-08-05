import { defineConfig } from 'tsup';

export default defineConfig([
  {
    // fallback-tags ships as its own entry: consumers that must tell this
    // library's table output from a page's text import the set from there.
    // mathml the same way, and for a reason of its own: the rule it builds is
    // useless without a MathML → LaTeX converter, which is a dependency this
    // package does not take, so it is the caller who reaches for the entry.
    entry: {
      browser: 'src/browser.ts',
      'fallback-tags': 'src/fallback-tags.ts',
      mathml: 'src/mathml.ts',
    },
    format: ['esm'],
    outExtension: () => ({ js: '.mjs' }),
    dts: true,
    outDir: 'dist',
    external: ['linkedom', 'happy-dom'],
    platform: 'browser',
    minify: true,
  },
  {
    entry: { server: 'src/server.ts' },
    format: ['esm', 'cjs'],
    outExtension: ({ format }) => ({ js: format === 'esm' ? '.mjs' : '.cjs' }),
    dts: true,
    outDir: 'dist',
    external: ['linkedom', 'happy-dom'],
    platform: 'node',
    minify: true,
  },
]);

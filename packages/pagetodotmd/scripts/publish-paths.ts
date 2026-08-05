/**
 * Turns the boundary paths `dist/` still carries into the public subpaths they
 * stand for.
 *
 * `src/engine.ts` names the converter by the path it sits at, because inside
 * this repository the two packages are read from source. `tsup` is told to leave
 * those three imports external, which keeps the converter out of this bundle and
 * out of these declarations — but external means *untouched*, so what reaches
 * `dist/` is `from "../../htmltodotmd/src/browser.js"`: a path that exists here
 * and in no tarball.
 *
 * Both halves need the repair and both get it here. A `.mjs` left unrepaired
 * fails loudly on the first import; a `.d.ts` left unrepaired fails silently,
 * because `skipLibCheck` is on in most consumers and the types simply resolve to
 * nothing.
 *
 * The map is imported from `tsup.config.ts` rather than restated. The build and
 * this repair therefore say the same three things, and adding a fourth is one
 * edit.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BOUNDARY } from '../tsup.config.js';

const dist = new URL('../dist/', import.meta.url).pathname;
let rewritten = 0;

/**
 * Every emitted file, at any depth.
 *
 * A flat listing was enough while `dist/` was flat — and it is today. It stops
 * being enough the moment the entries share anything, because tsup splits an ESM
 * build into `chunk-*.mjs` and the split can land in a subdirectory; the sibling
 * package already builds that way. A chunk missed by the walk keeps a path no
 * tarball has, and the check below would not see it either.
 */
async function emitted(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await emitted(path)));
    else if (/\.(mjs|cjs|js|d\.ts|d\.cts)$/.test(entry.name)) out.push(path);
  }
  return out;
}

const files = await emitted(dist);

for (const path of files) {
  const before = await readFile(path, 'utf8');
  let after = before;
  for (const [from, to] of Object.entries(BOUNDARY)) {
    after = after.split(`'${from}'`).join(`'${to}'`).split(`"${from}"`).join(`"${to}"`);
  }
  if (after !== before) {
    await writeFile(path, after);
    rewritten += 1;
  }
}

// A path left behind is a fourth thing crossing the boundary with no entry in
// `BOUNDARY` — add it there and to `src/engine.ts`, or import it through a
// subpath that already exists.
// Any relative spelling, not the one `engine.ts` happens to use today: a file
// that moves a directory changes the number of `..` segments, and a detector
// pinned to two of them would go quiet exactly when it was needed.
const leftovers: string[] = [];
for (const path of files) {
  const text = await readFile(path, 'utf8');
  if (/(?:^|['"(\s])[.]{1,2}(?:\/[.]{2})*\/[^'"\s]*htmltodotmd\//.test(text)) {
    leftovers.push(path.slice(dist.length));
  }
}
if (leftovers.length > 0) {
  console.error(`still reaching htmltodotmd by path: ${leftovers.join(', ')}`);
  process.exit(1);
}
console.log(`publish-paths: rewrote ${rewritten} file(s) in dist/`);

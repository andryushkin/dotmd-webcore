/**
 * Packs the tarball a consumer would install and imports every subpath out of it.
 *
 * `bun test` runs against `src/`, which is also how both consumers read this
 * repository today — so nothing in the suite can tell whether the *published*
 * package resolves at all. Everything between the source and a tarball is a
 * separate declaration that can be wrong on its own: an entry missing from
 * `tsup.config.ts`, a subpath in `exports` pointing at a file the build never
 * wrote, `files` too narrow to carry `dist/`, a `types` path off by a name. Each
 * of those is invisible here and fatal on the other side, where it reads as "this
 * package is broken" rather than "somebody forgot a line".
 *
 * So: pack, unpack, and for each subpath check that both halves of its condition
 * exist in the tarball and that the JavaScript half really imports — a module
 * with a runtime dependency this package is not allowed to have would fail here,
 * which is the other thing worth knowing about a published build.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const packageRoot = new URL('..', import.meta.url).pathname;

interface Manifest {
  name: string;
  exports: Record<string, { types: string; default: string }>;
}

const manifest = JSON.parse(
  await readFile(join(packageRoot, 'package.json'), 'utf8'),
) as Manifest;

const work = await mkdtemp(join(tmpdir(), 'dotmdtohtml-pack-'));
const failures: string[] = [];

try {
  const packed = Bun.spawnSync(['bun', 'pm', 'pack', '--destination', work], {
    cwd: packageRoot,
    stderr: 'pipe',
  });
  if (packed.exitCode !== 0) {
    console.error(new TextDecoder().decode(packed.stderr));
    process.exit(1);
  }

  // `bun pm pack` names the archive after the package and its version; asking the
  // directory rather than rebuilding that name keeps this working if it ever
  // stops being that.
  const glob = new Bun.Glob('*.tgz');
  const [archive] = [...glob.scanSync(work)];
  if (!archive) {
    console.error('pack-exports: no tarball was written');
    process.exit(1);
  }

  const extracted = Bun.spawnSync(['tar', '-xzf', join(work, archive), '-C', work], {
    stderr: 'pipe',
  });
  if (extracted.exitCode !== 0) {
    console.error(new TextDecoder().decode(extracted.stderr));
    process.exit(1);
  }

  // npm's own layout: everything in the tarball sits under `package/`.
  const root = join(work, 'package');

  for (const [subpath, condition] of Object.entries(manifest.exports)) {
    const name = `${manifest.name}${subpath.slice(1)}`;
    for (const [kind, relative] of Object.entries(condition)) {
      const path = join(root, relative);
      if (!(await Bun.file(path).exists())) {
        failures.push(`${name}: ${kind} → ${relative} is not in the tarball`);
        continue;
      }
      if (kind !== 'default') continue;
      try {
        const module = (await import(pathToFileURL(path).href)) as Record<string, unknown>;
        if (Object.keys(module).length === 0) {
          failures.push(`${name}: imported, but exports nothing`);
        }
      } catch (error) {
        failures.push(`${name}: does not import — ${String(error)}`);
      }
    }
  }
} finally {
  await rm(work, { recursive: true, force: true });
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`pack-exports: ${failure}`);
  process.exit(1);
}
console.log(`pack-exports: ${Object.keys(manifest.exports).length} subpath(s) resolve in the tarball`);

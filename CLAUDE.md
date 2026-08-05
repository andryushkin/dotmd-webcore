# dotmd-webcore — project notes

Three packages, one repository.

- **`packages/htmltodotmd`** — HTML → Markdown. Isomorphic by contract: a live
  DOM in a browser extension, linkedom in its tests, whatever a library caller
  brings. **Zero runtime dependencies** — not asceticism, the reason the engine
  can move into another product whole. Any dependency is an architecture change,
  discussed as one.
- **`packages/pagetodotmd`** — everything that needs a browser and a layout
  engine: the computed style recorded for a clone that has none, shadow trees,
  hard breaks, the selection work, and the capture that orders them. It depends on
  the converter and on nothing else.
- **`packages/dotmdtohtml`** — the same Markdown read back: the parser profile,
  `==highlight==`, maths held out of the markup until after the sanitizer, and the
  blank lines a page left. It depends on nothing at all — `marked`, DOMPurify and
  KaTeX are handed in, the way `createMathMLFallbackRule(convert)` takes its
  converter.

The repository is not the package. The three travel together because the second
writes what the first reads — attribute names, thresholds, verdicts, all of which
must have one spelling — and the third reads back what the first writes, down to
a marker no standard defines. Separate repositories would make every change to
either protocol a window of incompatibility. The zero-dependency rule holds at
the level of a package, and two of the three have none.

The dependency between them goes through **public subpath exports only**
(`htmltodotmd`, `/selection`, `/snapshot`), and `pagetodotmd/src/engine.ts` is the
only file allowed to name them. Consumers are Chrome extensions that vendor this
repository as a git submodule and import both **straight from source**, with no
build step in between; the `tsup` builds here serve a publication that has not
happened yet.

If `DOTMD.md` sits at the repository root, read it before planning any change:
private working notes, untracked here.

## Open the sheet before you edit (HARD)

Each package keeps its rules in a sheet of its own. Open the one covering the
path **before the first edit under it**.

| Path | Read first |
| --- | --- |
| `packages/htmltodotmd/src/` | `packages/htmltodotmd/docs/invariants/core.md` — output language, escaping, emphasis and style, reading a style, whitespace, rows drawn side by side, hiding, maths, blocks, code, tables, the package |
| `packages/pagetodotmd/src/` | `packages/pagetodotmd/docs/invariants/page.md` — the package boundary, the namespace, selection, hard breaks, the snapshot, rows and lines, entities, the shadow copy |
| `packages/dotmdtohtml/src/` | `packages/dotmdtohtml/docs/invariants/render.md` — injected engines, the two-step render, the dialect, maths, content gaps, contributions, plain text |

Every rule in them is a defect somebody already shipped — a highlight that
arrived missing, a heading with nothing above it, a formula that lost its level,
a component's content drawn twice while a capture ran — and nothing in the code
says so. The sheet is where the reason lives.

`packages/htmltodotmd/docs/LIBRARY_SPEC.md` describes the converter's behaviour
in full; `docs/CHROME_EXTENSION.md` beside it is the integration guide;
`docs/CONTRIBUTING.md` is for people arriving from an issue.

## Build and test

```bash
bun install        # once, from this directory: a workspace of two packages
bun test           # both suites
bun run tsc        # per package; bun checks no types, and each config is
                   # stricter than a consumer's
bun run lint       # ESLint
bun run build      # tsup → dist/, per package, used only to publish
```

`bun test` cannot see a browser. Everything that needs one — how a page's own CSS
reads, what a selection leaves behind — is verified in the consumer, against a
live page.

## What lives where

A conversion defect belongs in `htmltodotmd`, with a test beside it, never
patched around in a consumer: a repair made downstream leaves every other caller
with the defect. Anything that needs a layout engine — `getComputedStyle`,
measuring what stood on one line, a shadow tree, a `Selection` — belongs in
`pagetodotmd` and arrives in the converter as attributes on the nodes. What a
reader is *shown* of a finished note — a formula, a highlight, the blank lines a
page left — is `dotmdtohtml`, and a defect there costs the preview rather than
the file. No package may touch an extension API: what a product decides is the
product's, and it is handed over as options.

The fidelity gate is not here either. It lives in the clipper, because its oracle
depends on both this library and the extension's own options; it imports this
library's internals — `BOLD_THRESHOLD`, `hidingVerdict`, `SEMANTIC_BLOCKS`,
`foldedDetailsContent` — deliberately, since a second spelling of a threshold
would let this side move while the oracle went on measuring the old one. It reads
the result back with `dotmdtohtml`'s own profile and highlight extension, for
exactly that reason.

## Keep in sync (HARD)

Each of these is a pair that spans a package or a repository boundary, which is
exactly why it can drift silently.

- **A threshold or a reader in `htmltodotmd` ⇄ the clipper's fidelity oracle.**
  It imports them rather than restating them. Renaming one is a change on both
  sides.
- **What `pagetodotmd` writes ⇄ what `htmltodotmd` reads.** `paintedBackground()`
  and `isMonospaced()` are one spelling for both sides; the relative size written
  on every `role="heading"` is read there as an answer. Both sheets say which
  rules are halves of a pair, and the whole vocabulary is declared once, under the
  `htmltodotmd/snapshot` subpath.
- **A name crossing between the packages ⇄ `pagetodotmd/src/engine.ts` ⇄
  `BOUNDARY` in its `tsup.config.ts`.** One file lists what crosses, one map turns
  those paths into package specifiers when publishing, and
  `scripts/publish-paths.ts` refuses to finish if a path reached `dist/` without
  an entry — the only thing that would notice.
- **A subpath in `exports` ⇄ an entry in `tsup.config.ts` ⇄ the pack check.** Two
  halves of one declaration: a name in `exports` alone resolves to a file the
  build never wrote. Every suite here runs against `src/`, so only
  `dotmdtohtml/scripts/pack-exports.ts` — pack, unpack, import each subpath — can
  tell whether the published package resolves at all.
- **`marked` in `htmltodotmd` ⇄ `marked` in `dotmdtohtml` ⇄ the copy the clipper
  vendors.** All three are `12.0.2`, in two `devDependencies` and one vendored
  file: the tests use it to ask what the reader would actually see, and a second
  version lets a test pass against a renderer nobody ships.
- **Emitted syntax ⇄ `dotmdtohtml`.** `==highlight==` is not in CommonMark or
  GFM, and the renderer for it now lives here: the pair that used to span a
  repository boundary is two packages apart, and neither half moves alone. A
  consumer parsing this Markdown with anything else shows the reader four `=`
  characters. `escapeMathTags` is the same pair in the other direction: it
  defuses markup inside a formula by writing `\lt ` and `\gt `, delimiter space
  and all, and the inline maths tokenizer over there has to allow that space
  before a closing dollar or the whole formula is refused and the reader is shown
  its source.

## Conventions

- Everything written here — docs, comments, commit messages — is in English.
- The repository is public. Anything a stranger should not read goes to
  `DOTMD.md`, which is gitignored, and never into a commit message: those are not
  cleaned up by editing a file.
- Commit messages: `feat`, `fix`, `refactor`, `docs`, `chore`. Commit straight to
  `main`; do not push unless asked.
- Check `git status --short` before you start and leave what was already dirty out
  of your commit.

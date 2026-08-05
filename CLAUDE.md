# htmltodotmd — project notes

HTML → Markdown. Isomorphic by contract: a live DOM in a browser extension,
linkedom in these tests, whatever a library caller brings. **Zero runtime
dependencies** — that is not asceticism, it is the reason the engine can move
into another product whole. Any dependency is an architecture change, discussed
as one.

This repository is the library and nothing else. Its consumers are Chrome
extensions that vendor it as a git submodule and import it **straight from
source**, with no build step in between; the `tsup` build here serves a
publication that has not happened yet.

If `DOTMD.md` sits at the repository root, read it before planning any change:
private working notes, untracked here.

## Open the sheet before you edit (HARD)

`docs/invariants/core.md` holds the rules of this library — output language,
escaping, emphasis and style, reading a style, whitespace, rows drawn side by
side, hiding, maths, blocks, code, tables, the package. Open it **before the
first edit under `src/`**.

Every rule in it is a defect somebody already shipped — a highlight that arrived
missing, a heading with nothing above it, a formula that lost its level — and
nothing in the code says so. The sheet is where the reason lives.

`docs/LIBRARY_SPEC.md` describes behaviour in full; `docs/CHROME_EXTENSION.md` is
the integration guide; `docs/CONTRIBUTING.md` is for people arriving from an
issue.

## Build and test

```bash
bun install        # once
bun test           # the suite: 1378 tests
bunx tsc --noEmit  # bun does not check types; this config is stricter than a consumer's
bun run lint       # ESLint
bun run build      # tsup → dist/, used only to publish
```

`bun test` cannot see a browser. Everything that needs one — how a page's own CSS
reads, what a selection leaves behind — is verified in the consumer, against a
live page.

## What lives here and what does not

A conversion defect belongs **here**, with a test in `tests/`, never patched
around in a consumer: a repair made downstream leaves every other caller with the
defect. Conversely, anything that needs a layout engine — `getComputedStyle`,
measuring what stood on one line — belongs to the consumer that reads the live
page, and arrives here as attributes on the nodes.

The fidelity gate is not here either. It lives in the clipper, because its oracle
depends on both this library and the extension's own options; it imports this
library's internals — `BOLD_THRESHOLD`, `hidingVerdict`, `SEMANTIC_BLOCKS`,
`foldedDetailsContent` — deliberately, since a second spelling of a threshold
would let this side move while the oracle went on measuring the old one.

## Keep in sync (HARD)

Each of these is a pair that spans a repository boundary, which is exactly why it
can drift silently.

- **A threshold or a reader here ⇄ the clipper's fidelity oracle.** It imports
  them rather than restating them. Renaming one is a change on both sides.
- **What the snapshot writes ⇄ what this library reads.** `paintedBackground()`
  and `isMonospaced()` are one spelling for both sides; the relative size written
  on every `role="heading"` is read here as an answer. The sheet says which rules
  are halves of a pair.
- **`marked` here ⇄ the copy the clipper vendors.** It is pinned to `12.0.2`
  because the tests use it to ask what the reader would actually see; two
  versions would let a test pass against a renderer nobody ships.
- **Emitted syntax ⇄ the consumer's renderer.** `==highlight==` is not in
  CommonMark or GFM: a consumer without an extension for it shows the reader four
  `=` characters.

## Conventions

- Everything written here — docs, comments, commit messages — is in English.
- The repository is public. Anything a stranger should not read goes to
  `DOTMD.md`, which is gitignored, and never into a commit message: those are not
  cleaned up by editing a file.
- Commit messages: `feat`, `fix`, `refactor`, `docs`, `chore`. Commit straight to
  `main`; do not push unless asked.
- Check `git status --short` before you start and leave what was already dirty out
  of your commit.

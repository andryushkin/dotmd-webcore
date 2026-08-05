# dotmd-webcore

The conversion pipeline behind the dotMD browser extensions, as three packages.

| Package | What it is |
| --- | --- |
| [`packages/htmltodotmd`](./packages/htmltodotmd) | HTML → Markdown. Zero runtime dependencies, isomorphic: a browser, Node, Bun, or linkedom in a test. |
| [`packages/pagetodotmd`](./packages/pagetodotmd) | Everything that needs a browser and a layout engine: computed style recorded for a clone that has none, shadow trees, hard breaks, selection capture. |
| [`packages/dotmdtohtml`](./packages/dotmdtohtml) | The same Markdown back to a document: the parser profile, `==highlight==`, maths kept out of the markup, the blank lines a page left. `marked`, DOMPurify and KaTeX arrive as arguments, so it has no dependencies either. |

They are three packages and one repository on purpose. The second writes what the
first reads — attribute names, thresholds and verdicts that must have exactly one
spelling — and the third reads back what the first wrote, down to a highlight
marker no standard defines. A change to either protocol has to land on both
sides at once; separate repositories would turn every one of them into a window
in which the two disagree.

Consumers vendor this repository as a git submodule and import both packages
straight from source, so a defect is fixed here, in the same working copy, and
the pointer moves in the same change.

```bash
bun install        # once, from this directory
bun test           # every package
bun run build      # tsup, per package — used only to publish
```

MIT.

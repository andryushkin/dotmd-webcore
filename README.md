# dotmd-webcore

The conversion pipeline behind the dotMD browser extensions, as two packages.

| Package | What it is |
| --- | --- |
| [`packages/htmltodotmd`](./packages/htmltodotmd) | HTML → Markdown. Zero runtime dependencies, isomorphic: a browser, Node, Bun, or linkedom in a test. |
| [`packages/pagetodotmd`](./packages/pagetodotmd) | Everything that needs a browser and a layout engine: computed style recorded for a clone that has none, shadow trees, hard breaks, selection capture. |

They are two packages and one repository on purpose. The second writes what the
first reads — attribute names, thresholds and verdicts that must have exactly one
spelling — so a change to that protocol has to land in both at once. Separate
repositories would turn every such change into a window in which the two
disagree.

Consumers vendor this repository as a git submodule and import both packages
straight from source, so a defect is fixed here, in the same working copy, and
the pointer moves in the same change.

```bash
bun install        # once, from this directory
bun test           # both packages
bun run build      # tsup, per package — used only to publish
```

MIT.

# Real-page extract fixtures

Frozen **structural** copies used by `extract.test.ts` to lock two defects found
on live pages. They are not a contract with the network: a live site drifts, and
these files do not track it.

Each file keeps only the landmarks, class names and nesting that made the scorer
or the furniture list go wrong. The prose is original to this repository — not a
verbatim article — so the fixtures can sit in an MIT-licensed tree without
carrying a third-party content licence.

| File | Shape taken from | Fetched (live capture) | Upstream licence (for the live page) | Route |
| --- | --- | --- | --- | --- |
| `simonwillison.net_2026_Jan_1_.html` | https://simonwillison.net/2026/Jan/1/ | 2026-08-07 | No licence stated on the blog | Structural reconstruction. Original dump was 17 KB of a personal site with no licence grant; the defect is the `div#smallhead` / `#wrapper` / `#primary` / `#secondary` shape, not any particular sentence. |
| `developer.mozilla.org_en-US_docs_Web_CSS.html` | https://developer.mozilla.org/en-US/docs/Web/CSS (cascade intro) | 2026-08-07 | [CC-BY-SA 2.5+](https://developer.mozilla.org/en-US/docs/MDN/Writing_guidelines/Attrib_copyright_license) | Structural reconstruction. Live dump was 334 KB of CC-BY-SA body text; the defect guard is the `main` + `aside.reference-layout__toc` / `nav.reference-toc` shape with in-page fragment links. |
| `en.wikipedia.org_wiki_Diffusion.html` | https://en.wikipedia.org/wiki/Diffusion | 2026-08-07 | [CC BY-SA 4.0](https://en.wikipedia.org/wiki/Wikipedia:Text_of_the_Creative_Commons_Attribution-ShareAlike_4.0_International_License) | Structural reconstruction. Live dump was 538 KB of article text, references and navboxes; the defect needs the titlebar `vector-toc-landmark` toggle, `#p-lang-btn`, tools landmarks, and enough prose under `#mw-content-text` to clear the length floor — not the encyclopedia article. |

If a future change needs a new real page, prefer the same route: capture once
privately, reduce to the minimal structure that still fails or passes, rewrite
the prose, and record source URL, date and upstream licence in this table.
Do not commit multi-hundred-kilobyte third-party HTML into the public tree.

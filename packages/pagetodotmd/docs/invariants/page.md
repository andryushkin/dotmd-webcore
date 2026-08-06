# pagetodotmd — invariants

Reading a live page. Everything here is constrained by that: a layout engine
answers questions no clone can, it answers them only before the next DOM change,
and every answer is written onto somebody else's document and taken back off.

Each rule below has cost a bug already; the reason is what makes it stick. An
unqualified file name is in `src/`; anything else is written from this package's
root. What the *conversion* does with what is recorded here is
`../../htmltodotmd/docs/invariants/core.md` — half the rules below are one end
of a pair whose other end is in that sheet.

## The package

- Nothing here may touch an extension API, a global `window` or a global
  `document`. The environment arrives as an argument — the document, the
  selection, the view whose `getComputedStyle` answers — which is what lets a
  test drive a capture and what lets two products share one. `captureStyles()`
  named the bare `window` global once, and that put the whole function out of
  reach of every test.
- **`src/engine.ts` is the only file that may import `htmltodotmd`**, and it
  names what crosses one symbol at a time. Never `export *`: a star re-export of
  an external module is opaque to a bundler, which made the generated types guess
  which entry a name came from. Never a deep import either — `src/utils/…` is not
  a contract, and reaching into it made every rename inside the converter a break
  nothing could see coming.
- The published graph is derived from that one file, never restated:
  `tsup.config.ts` marks the three paths external and `scripts/publish-paths.ts`
  rewrites them into the subpaths they stand for, in `.mjs` and `.d.ts` alike,
  and refuses to finish if a fourth reached `dist/`. An unrepaired `.mjs` fails on
  the first import; an unrepaired `.d.ts` fails silently, because `skipLibCheck`
  is on in most consumers.
- The consumer's *policy* is handed over, never assembled here. Where a clip's
  headings start, whether page furniture inside a selection survives, what
  becomes of a table GFM cannot express: each is argued from what a person does
  with the file afterwards. `baseUrl` is the one exception and is filled in from
  the document, which is this package's own input.
- **`prepareClone` is the optional way into a finished clone**, and it is off by
  default. Both capture paths call it once per fragment after own-UI, hard breaks
  and namespace canonicalization, and before `serialize` / the heading probe /
  conversion — so `withHtml` shows what the converter was given. A throw is
  swallowed: a consumer's hook is not a reason to fail a capture or to leave the
  page dirty. With no hook, every path is byte-for-byte what it was.
- **`openDetails` and `materializeCurrentSrc` are exports this package never
  calls.** They are a reading-mode product's policy, not the clipper's. The
  clipper's written answer is the opposite: a collapsed `<details>` contributes
  its `<summary>` alone (`foldCollapsedDetails` in the converter), and an image's
  address is whatever the markup lists. Mechanism lives here; which product flips
  the switch is that product's. Both edit the clone only — never the live page —
  so a site's `toggle` handlers and `<details name>` groups stay out of the
  capture. Live `currentSrc` is a layout answer a detached clone does not have,
  so the consumer builds a map with `collectCurrentSrc` on the live root
  **before** the capture (read-only — no attribute is written, or the style
  snapshot that follows would pay a recalculation per element) and hands it to
  `materializeCurrentSrc`. The key is `imageAddressSignature` and only that —
  address attributes the clone still carries after `dropOwnUI` / `exclude`, not
  a document-order zip (which mis-assigns every image after the first excluded
  one) and not a mark on the live node. Under linkedom `img.currentSrc` is
  `undefined`, so Chrome is the last word on the values. The attributes stripped
  are a **pair** with `extractImageUrl` in the converter (`IMAGE_ADDRESS_ATTRS`):
  every source of an address there is a name that must come off the clone here,
  or writing `src` alone changes nothing. The placeholder verdict is another
  **pair** with `isPlaceholder` there (`isPlaceholderSrc` here): a `currentSrc`
  that is only a loading stand-in must not replace the lazy-load attributes the
  converter would have preferred. `materializeCurrentSrc` promises the
  **picture the document should hold**, not the pixels currently painted — when
  the loader has not fired, `currentSrc` is still the markup `src` while
  `data-src` holds the real address, and that state leaves the element alone.

## The namespace

- Every attribute a capture writes on the live page is named by a frozen
  `CaptureNamespace`, taken from `CaptureOptions` and passed down explicitly.
  **Never a module-level `configureNamespace()`**: a setting is what two
  consumers in one realm take turns overwriting for each other, and the damage
  would show up nowhere near the call that caused it.
- The prefix belongs to a consumer, the object to a capture. A consumer's own-UI
  mark goes on when it draws its bubble, minutes before any capture exists, so a
  name minted per session could never have been on it.
- `style` and `row` are **imported** from `htmltodotmd/snapshot`, never spelled
  again. `ROW_ATTR` was written out a second time in the content script under a
  comment saying the two sides could not disagree: its value crossed the boundary
  and its name did not, and nothing failed until the converter renamed it.
- The page speaks the session's dialect; the clone handed to `toMarkdown` speaks
  the converter's. `canonicalize()` is that seam, and it is the right place for it
  — the collision is on the live page, where two consumers write at once, and a
  detached clone is private to one capture. A name threaded into the converter
  instead would put a plumbing argument through `laysARow`, `drawnOnOneLine` and
  `statesConversion`, which are asked from the parser, the sanitizer, the flanking
  walk and four rules, most with no options in hand. It also drops the page's own
  copy of the converter's name: this capture did not write it, so nothing here
  knows what it means, and left there the converter reads it as a style somebody
  measured.
- The four names `enrichRange` uses on the live page are the `PageMarks` it is
  handed. Two it writes — they come off in a `finally`, which is what kept them
  harmless while there was one consumer. Two it **reads**, and those are the
  sharper half: `wrapInRow` asks the live common ancestor whether a snapshot
  marked it as a row and whether its style says anything the conversion reads.
  Both attributes were written by whoever holds the live nodes, under *their*
  names, so a consumer spelling them anything but the default got silence from
  both — and a drag across a sentence inside a flex row came back as one
  paragraph per item, which is the defect `wrapInRow` exists to prevent.

## Selection

- `cloneContents()` already closes cut tags; the work is restoring what the
  selection left behind. A range crossing *out* of a table has no semantic common
  ancestor, so table headers are restored separately. Clones carry no link to
  originals: mark before cloning, unmark in a `finally`, and detect the header by
  that mark — comparing `textContent` promoted a body row that repeated it. The
  page may own the attribute, so restore its value in the `finally`, not remove.
- A selection made *inside* an open shadow root is invisible to `getRangeAt()`:
  the browser moves both endpoints onto the host, so the range arrives collapsed
  in front of it and the capture was empty. `shadow-selection.ts` asks
  `getComposedRanges()` instead, naming every open root — Chrome 137, well above
  the extension's floor, so the document-tree answer stays as the fallback. A
  live `Range` cannot hold two trees, so a selection that crosses out of a
  component lifts its deeper end to the host: over-capturing the component to its
  end costs a sentence, losing the range costs the capture.

## Hard breaks

- A `\n` inside a text node draws a line only where the computed `white-space`
  preserves it (`pre`, `pre-wrap`, `pre-line`, `break-spaces`). A tag list cannot
  answer that, and the `style` attribute cannot either — the old guard read
  `white-space: pre` off an *ancestor of the clone*, which keeps nothing above
  the range's common ancestor, so on an ordinary drag it never saw the styled box
  at all, and its regex was inverted besides: the one value meaning "the reader
  saw these breaks" was read as a reason to skip the rewrite. Under `normal` the
  browser draws a space, and every indented `<p>` was arriving with a hard break
  per source line.
- The verdict is taken in `captureStyles()` beside the snapshot, read-before-write
  like it, and marked with `namespace.hardBreak` — this package's own attribute, never a
  `white-space` declaration in `data-s2md-style`. The core already has a
  whitespace model keyed by tag (`PRESERVE_WS`); a second one on the other side of
  the capture is free to disagree, and then the break is drawn twice. The mark is
  stripped from the fragment before conversion and restored on the page in a
  `finally`.
- The tag half of that model is *asked* of the core — `preservesSourceWhitespace()`,
  a predicate rather than the set, which a caller could edit mid-run. Spelled out
  again here, a tag added there and not here is the doubled break, unseen from this
  side. `NON_PROSE_TAGS` stays separate because it claims something else: `script`,
  `svg` and a maths subtree hold no prose for a break to belong to, and in the
  core's set they would stop the sanitizer collapsing whitespace inside them.
- A newline at the edge of a *node* is not one at the edge of a line. Trimming a whitespace-only
  part off either end is right when the edge is a block's — that break is the markup's indentation
  between a tag and its text — and wrong when a run of text continues beside it. X writes a tweet as
  spans under one `white-space: pre-wrap` box and puts the paragraph break at the end of a span, so
  the trim cost a 9,000-word thread every paragraph it had: it arrived as one. The question walks the
  siblings and then out through inline wrappers only, stopping at anything that would have ended the
  line anyway. Beside is not only text: a replaced element — a picture, a player, a form control —
  paints a box that `textContent` cannot see, so a caption ending in a newline in front of one lost
  the line the reader saw. Those tags count as drawn whether or not the file has a place for them; a
  break with nothing left after it is dropped anyway, so counting one costs no backslash.
- A clone is not enough on its own: `cloneContents()` strands the common
  ancestor's children at the top of the fragment, where a text node has no parent
  element to carry a mark — which is exactly the ordinary selection. The live
  range is asked as well.

## Style snapshot

- `snapshotStyles()` (`style-snapshot.ts`) is the only `getComputedStyle` in the
  product. It runs before any DOM mutation and writes nothing while it walks —
  setting an attribute invalidates Chrome's style cache, so a walk that wrote as
  it went would pay for a recalculation per element. It records only what the tag
  and the parent do not already imply, which is both what keeps the markup small
  and what lets a run cut out of its bold paragraph stay plain. It walks
  `shadowRoot` too: `mirrorShadowRoots()` copies `innerHTML`, which carries
  attributes and nothing else, so a component not snapshotted first arrives
  unstyled for good. `snapshotScope()` cannot answer for a shadow root — a
  `DocumentFragment` is not an element — so a selection whose common ancestor is
  one hands over the host instead, or the whole component arrives unstyled. Marks
  come off in a `finally`, restoring the page's value.
- What the *parent's layout* implies is not the page's word either. A flex or
  grid container blockifies its items, so an `<a>` in a navigation row computes
  `display: block` though nothing said so — recorded, that turned twelve links
  into twelve paragraphs where the reader saw one line. Only the content script
  can tell: the difference is in the container's computed `display`, which the
  core never sees. A flex *column* and a grid one column wide do stack, and there
  the mark is kept — the column count comes from the used
  `grid-template-columns`, which only live nodes have. `table` does not blockify,
  measured rather than assumed.
- That silence has two exceptions, both about `visibility`. The first is the only
  way the snapshot can *take something back*: where the page's own `style` hides
  an element and the cascade overruled it, the computed value has to be written
  down, because the core falls back on the attribute wherever the snapshot says
  nothing. Same reason a `visibility:hidden` mark is settled on the way *out* of
  the walk — until the subtree has been read, nothing knows whether something
  below is visible, and deciding in document order kept a hidden paragraph
  whenever a visible sibling happened to follow it.
- The second states a hiding the cascade agrees with, and it is a *pair*: a box
  that is invisible with something visible under it says `visibility:hidden`, and
  the descendant that takes the property back says `visibility:visible`. The core
  keeps such a box for the descendant's sake and drops the text the box itself
  holds — but only if it is told, and a class-hidden box tells it nothing on its
  own. Either mark alone is worse than neither: with the first, `revealedBelow()`
  finds nothing and the whole box goes, visible text and all. Both are written
  where the state *changes*, so a revealed subtree costs one mark rather than one
  per element, and a page with no hidden boxes costs nothing.
- A background is the one thing here that cannot be read off an element at all: `background-color`
  does not inherit, so a computed style answers `rgba(0, 0, 0, 0)` over almost the whole of a page
  and says nothing about what is painted *behind* the element. The walk carries the nearest painted
  ancestor's colour as part of the inheritance and writes the element's own only where it differs —
  which is exactly what makes a fill a highlight rather than the box a run happens to sit in. The
  core cannot ask this: it is handed a detached fragment where the ancestors' computed styles are
  not, and every child of a themed card would take a marker. Written only on something that is not a
  block, which is also what keeps the attribute off most of a page — blocks are most of what a page
  paints, and a card, a callout or a striped row is no marked phrase. The verdict itself is
  `paintedBackground()` in the core, asked of the computed style here and of the snapshot there.
- One property breaks the "only what is not already implied" rule on purpose, and it is the only
  one: an element carrying `role="heading"` gets its size written down whether or not it differs,
  as a ratio of the text it sits in (`font-size:1.5em`, `font-size:1em`). The core has to read
  silence there as an answer — a `<div>` claiming to be a heading is drawn like body text unless a
  stylesheet says otherwise, and the clone cannot see a stylesheet — and silence is only readable
  where something positive says the drawing was read at all. `1em` is that something. A ratio rather
  than a length because 24px is a heading on one page and body text on another, and because the size
  it would be compared against sits on the parent, which a selection starting at the heading leaves
  outside the fragment. Written nowhere else: nothing on the other side reads a size anywhere else,
  and an attribute per element is what a page-sized budget cannot pay. Both sizes or neither — a
  caller whose computed style answers nothing about `font-size` has not read the drawing, and a `1em`
  written there would claim it had.
- The verdicts themselves live in the converter and are asked of it, never spelled
  again here: the two sides disagreeing is how a snapshot marks what the core
  keeps. The *names* too — `SNAPSHOT_ATTR` and `ROW_ATTR` are imported, never
  restated. `ROW_ATTR` was spelled a second time here under a comment saying the
  two sides could not disagree: its value crossed the boundary and its name did
  not, and nothing fails until the core renames the attribute.
- The scope a snapshot walks is `snapshotScopeOf()`, asked by every path that has
  one. It reaches up to a `<table>` because `enrichRange` hands a selection inside
  one its header row from above — a reason that was written out twice.

## Rows and lines

The other half of this pair is under *Rows drawn side by side* in
`../../htmltodotmd/docs/invariants/core.md`: what is measured here is spent there.

- Silence about a derived block leaves the *gap* between the items unsaid, and markup has none:
  `<a>c#</a><a>python</a>` is what a tag list is. The container — not the item — gets
  `data-s2md-row`, once, and the core turns it into the one blank the reader saw. Recording it per
  item would be the paragraph-per-link defect again by another name.
- `flex-direction` is wrong twice — about a row the window was too narrow for, and about a *column
  holding one item*, which stacks nothing: the item and the container are in the same place, and
  where that place is was settled higher up. So the lines are counted. A `Range` over the container's
  contents gives one rectangle per fragment drawn, and one band means `data-s2md-row="line"` rather
  than `"1"` — which is what repairs a mention in a flex row arriving as three paragraphs. Two
  rectangles share a band when they overlap by half the shorter of them (never an equal `top`, which
  two sizes on one baseline do not have), each asked against the *intersection* of the ones before
  it, so a tall picture cannot fuse the five lines of the paragraph beside it. Zero area is dropped
  first, or a box painted nothing in parts a sentence.
- Asked only where the answer can change the file — of a container that does not already read as a
  row, and of one that does only when an item is in `LINE_ITEM_TAGS` — and only under 256 nodes, a
  page shell being a flex box as often as a byline is. That refused two thirds to nine tenths of the
  flex boxes on four real pages; the rest cost 0.4–9.7 ms over the whole `<body>`. No measurement is
  the ordinary case: linkedom, a server and a detached tree answer nothing, and there the capture is
  exactly what it was.

## Entities and titles

- `html-entities.ts` is generated from the WHATWG table — never hand-edit or
  trim it. The decoder matches longest-first, so a partial table makes
  `&notin;` collapse to `¬in;` via the legacy `&not` name.
- Truncate titles by grapheme (`Intl.Segmenter`), never `slice()`, which splits
  emoji sequences that then reach the front matter and the filename.
- Entity behavior cannot be tested through the DOM — linkedom does not decode
  entities; tests compare against the reference table.

## The shadow copy

- Wrap `mirrorShadowRoots()` in try/finally so its cleanup always runs, and take
  the undo it hands back even when a copy faults half way through planting them.
- A shadow tree is not among its host's children, so a range covering the host
  clones an empty element. `mirrorShadowRoots()` puts a copy inside the host for
  the length of the capture, and the reader must not see it move.
- **What draws a light child is a `<slot>`, so the copy must be assigned to
  none.** It was an `<s2md-shadow>` element with nothing said about its slot,
  under a comment claiming that was enough — true only for a component whose
  shadow tree has no default `<slot>`, and a default slot takes every unassigned
  light child, which is what the commonest web component has. On one of those the
  copy was drawn, and the reader watched the component's content appear twice. The
  copy now claims a named slot, and refuses that name where the root declares one
  to match.
- A `<span>`, never a hyphenated tag: a hyphenated name *is* a custom element
  name, so `createElement()` of one runs whatever constructor the page registered
  under it — the page's own code, executed by a capture, inside the host it is
  copying. A built-in tag cannot be a custom element.
- The two do **not** convert identically, and that is the second reason for the
  `<span>`. It is in the converter's `HANDS_CONTENT_BACK`, so the text either
  side of it is read as one run; an unknown tag is opaque, and `<p><x>a </x> b</p>`
  came out `a  b` where the reader saw one space. A wrapper the capture invented
  must not change what the words around it look like — the page did not write it.
- The marker attribute is a **label, not an instruction**. The copy *is* the
  component's content; anything that strips it from the clone empties every
  capture of a web component.
- Neither of those can be checked away from a browser. happy-dom models neither
  slot assignment nor a custom element's side effects — the tests say so in their
  first line — so what they hold is the rule, and the last word is a component
  with a default slot in Chrome (`docs/test_conversion_spec_page.html`, case Q6).
- A host's light children are drawn only where a `<slot>` calls for them, so a component with no
  matching slot renders none of them — which is exactly how a no-JavaScript fallback is written.
  GitHub's `<relative-time>` holds `Jul 24, 2026` in the light DOM and shows `3 days ago` from its
  shadow tree, and with the copy planted beside the fallback every date came out as
  `3 days agoJul 24, 2026`. Those children are lifted for the length of the capture and put back in
  a `finally`, backwards, so each finds the sibling it stood in front of already in place. The
  assignment is worked out from the slots and never from `assignedSlot`: only a browser has that
  property, and these paths are also exercised under happy-dom, where it is `undefined` for assigned
  and unassigned children alike. Nothing is lifted where a matching slot exists — an unrendered
  child costs a duplicated line, a rendered one lifted by mistake costs the sentence it held.

## Article extraction

Free functions a consumer calls *before* capture. They must not run as a side
effect of `selectionToCapture` or `highlightsToMd` — those paths keep their
signatures and their output byte for byte. The clipper and a reading mode both
want "the article on this page"; neither should re-score the DOM alone.

- **`findArticle(doc)` scores candidates, never first-match.** Candidates are
  `<main>`, `<article>`, `[role="main"]`, `[itemprop="articleBody"]`, and
  schema.org Article-typed nodes. A feed wraps a dozen `<article>`s in `<main>`,
  and plenty of pages put a teaser or paywall banner first under `[role="main"]`.
  First match hands back somebody else's short paragraph while the article
  disappears and the overlay reports success. Length of *visible* text is the
  primary score; an `h1`, paragraph density, and a class penalty for
  `card|teaser|related|promo` move the ranking; a ratio to `body` may *add* and
  never vetoes — an article can legitimately be a tenth of the page when the rest
  is comments and a feed. A container that holds several substantial nested
  articles is penalised as a feed shell so one leaf wins.
- **The result is a list of nodes, not a single root.** Ordinary markup puts the
  title outside the body (`<main><h1>…</h1><article>…</article></main>`). The
  scorer honestly picks `<article>` where the paragraphs live; a capture of that
  root alone ships a document with no title and a length that still passed every
  threshold. The heading is lifted under a narrow rule only: an `h1`–`h2`, only
  the nearest preceding one under the same sectioning parent, with no other
  `<article>` between them, and only when it **strictly outranks** every
  heading the root already holds (level, not presence: an inside `h2` section
  heading is ordinary structure and must not block an outside `h1`; equal rank
  — outside `h1` + inside `h1`, or outside `h2` + inside `h2` — means the root
  already has a title of that level and the outside one stays put). Refusing on
  *any* inside h1–h2 was the defect that dropped the real title whenever the
  article had subheadings and left `topHeadingLevel: 1` promoting a section
  into the document title. **Never out of the page banner.** `role="banner"` is
  explicit; a `<header>` that is not nested inside sectioning content or
  `<main>` is the same thing (the ordinary blog is
  `<body><header><h1>Site</h1></header><article>`, with no `<main>`, and lifting
  that h1 opened the document on the site name). A title header *inside*
  `<main>` is not a banner and may still yield its h1. A lifted `h1` sets
  `metrics.hasH1` so a consumer that asks whether it got a whole document sees
  the title that was outside the root. Capture already takes the contents of
  each element it is handed (`highlightsToMd`), so `[h1, article]` arrives
  intact; joining several fragments already exists (`join-fragments.ts`).
- **Furniture inside a wide root is a list of selectors, not a rewrite.** When a
  site wraps everything in `<main>`, the capture would keep the `<nav>`, the
  newsletter `<aside>` and the "read next" strip. `CaptureOptions.exclude`
  already drops selectors from the clone; what was missing is the list, and the
  thing that picked the root builds it. Conjunction of signals: a semantic tag
  (`nav` / `aside` / `footer`) or a furniture class, *and* a position outside the
  accepted body, *and* not a same-document table of contents. "Outside the body"
  is a **visible-text** share (≥ ¼ of the root's characters, and only when the
  element itself has at least ~120 characters), not a paragraph count: on a
  three-paragraph post one newsletter `<p>` is already a third of the paragraphs
  and would keep "Subscribe…" in the file under `mode: "selection"`, which is
  what the reading mode passes — the default conversion profile drops `<aside>`
  for its own reasons and hid this. Link density alone is not enough either — a
  documentation TOC and a list of sources have the same density, and density
  alone would cut the wanted half. The suite asserts the furniture is gone from
  the Markdown after `highlightsToMd`, not merely from the selector list.
- **Visibility is an injected predicate.** Defaults to "everything is visible".
  Under linkedom and happy-dom a `display: none` node still contributes text, so
  a default that tried to read the cascade here would claim a certainty the
  harness cannot give. A real browser injects the answer from `getComputedStyle`,
  the same shape `computedStyleIn(view)` already uses for the snapshot.
- **Refusal hands back numbers, not a product policy.** Soft floor on visible
  text (`DEFAULT_MIN_TEXT_LENGTH`, overridable; `0` never refuses on length). The
  metrics always accompany a refusal so a consumer can set its own threshold and
  show "nothing readable" instead of an empty overlay. Hard refuse when the
  chosen root *is* an `iframe` or a `canvas` with almost no prose — that is a
  wrong document, not a short one.
- **Declared limits — what this cannot catch.** A closed shadow root is
  indistinguishable from an empty host; a page rendered into `<canvas>` or an
  article inside an `iframe` will happily reach any length threshold on menus and
  fallback text and hand back a wrong document rather than a refusal, except for
  the honest rule above when the chosen root itself is that `iframe` or `canvas`.
  The corpus under `tests/extract-fixtures/` states a hit rate on hand-written
  shapes; it does not measure a live cascade.

## Fragment ids

- **`collectFragmentIds(doc)` is a free function**, not a field on the capture
  result. The Markdown round trip loses `id`s (`normalizeFragment` in the
  converter strips cloned ids), so the map from an original `id` to what it
  should become has to be taken from the live page — after conversion there is
  nothing left to rebuild it from.
- **Internal-ness is one rule for bare hashes and absolute URLs.** By the time
  anything is rendered, `resolveUrl` has already run every relative through
  `new URL(url, baseUrl)`, so `href.startsWith('#')` never fires on the converted
  markup. A raw `#id` is not "internal" either: with
  `<base href="https://cdn.example/…">` the fragment resolves against that base
  and points into another document. Resolve every `href` through
  `new URL(raw, document.baseURI)`, drop the hash from both the link and the
  *document* address (`document.URL`, not `baseURI`), and compare the serialized
  `origin + pathname + search`. Do not decode the path or the query; do not
  equate `/a` with `/a/`. Percent-encoded *fragments* are decoded for lookup, and
  a malformed encoding must not throw.
- **No slug is computed here.** The slug an anchor must match is printed by
  `dotmdtohtml` when it renders the document. This package does not depend on
  `dotmdtohtml` and must not start to — a second slug implementation is the drift
  "Keep in sync" exists to prevent. What is handed back is the original `id`, the
  tag name, and heading text where the target *is* a heading. The consumer joins
  by text. A non-heading target (paragraph, figure, footnote item) has no
  counterpart after the round trip; the honest behaviour is to leave that link
  pointing at the original page.

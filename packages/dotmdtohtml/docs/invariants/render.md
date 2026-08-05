# dotmdtohtml — invariants

Markdown back to a document, in the dialect `htmltodotmd` writes. Everything here
is constrained by that: the file was produced by a converter with opinions, it is
read by a person who is about to compare it against the page it came from, and
the preview is the one place they check.

Each rule below has cost a bug already; the reason is what makes it stick. An
unqualified file name is in `src/`. What the *conversion* emits — and therefore
what this package must be able to read — is
`../../../htmltodotmd/docs/invariants/core.md`; several rules here are one end of
a pair whose other end is there.

## The package

- **`marked`, DOMPurify and KaTeX arrive as arguments.** Zero runtime
  dependencies, for the reason the converter has none: a product already has all
  three, under a content security policy that decides what may be loaded and at a
  version its other tests pin. A dependency here would ship a second parser to
  every consumer, and — `marked` in particular — a second one free to disagree
  with the copy the converter's own tests render with.
- **How the typesetter is called is *not* handed over.** `renderMath()` fixes
  `throwOnError: false`, `output: 'html'` and `trust: false`. A consumer passing a
  formally compatible `renderToString` is a consumer who can turn any of them the
  other way, and each is the difference between a formula that fails softly and a
  note that can draw a live link through `\href`.
- **Nothing here may touch a product API, a global `window` or a global
  `document`.** The element to write into is an argument; the plain-text subpath
  takes the document it builds its throwaway element in. A service worker naming a
  download has no `document` at all.
- **`render()` is synchronous.** A contract, not an implementation detail: a panel
  renders on every keystroke, and an asynchronous parser gives a race in which a
  render started earlier finishes later and overwrites newer text with an older
  document.
- **The sanitizer runs inside `render()`, before the markup is handed back.** The
  order — parse, sanitize, write, hydrate — belongs to this package for the same
  reason the capture's ordering belongs to `pagetodotmd`: a consumer who
  assembles it is a consumer who can leave a step out, and the step here is the
  one that keeps a captured page from putting a working `<img onerror>` into a
  reader's document.
- **One parser per renderer, built once.** Never `use()` per render — `marked`
  accumulates registrations — and never the module-wide `marked` a consumer
  already has: the maths extensions carry the formulas of a single render, and
  registering those on the shared object puts them in front of every other caller
  of it. The panel did exactly that, and its plain-text hand-off worked only
  because the preview's configuration happened to have run first.
- **A subpath in `exports` ⇄ an entry in `tsup.config.ts` ⇄ the pack check.**
  `bun test` runs against `src/`, so nothing in the suite can tell whether the
  published package resolves at all. `scripts/pack-exports.ts` packs the tarball,
  unpacks it and imports every subpath out of it; it is the only thing that would
  notice a name in `exports` pointing at a file the build never wrote. The
  stylesheets are subpaths on the same terms and the ones likeliest to go
  missing: they are copied by `publicDir` rather than compiled from an entry, so
  a rename in `styles/` leaves `exports` pointing at nothing and every other
  check here passes. They are asked whether they are in the tarball and whether
  they have any content, which is all a file a browser reads can be asked.

## The document's styles

Markup a theme cannot select on is markup a theme cannot style, so this package
ships the stylesheets as well — `styles/base.css` and `styles/themes/*.css`, out
under `dotmdtohtml/base.css` and `dotmdtohtml/themes/<id>.css`, with
`DOTMD_THEMES` naming them for a product that offers a choice. Choosing is the
product's, and none of it is here.

- **`base.css` is not a theme and not optional.** Three of its rules are the
  reason it exists: a display formula is a `<span>` and only `display: block`
  puts it back on a line of its own; the blank lines a page left are an empty
  `<div>` and only a height makes them worth anything; a task item's marker is
  its checkbox and only `list-style-type: none` stops a bullet appearing beside
  it. All three lived in a *product's* stylesheet, where nothing said the
  renderer depended on them, and deleting any one changes the document silently
  rather than breaking anything. A theme adds to this sheet; it never replaces
  it, because a theme that had to restate all three is the arrangement that
  already failed.
- **The root is not the host.** `.dotmd-doc` is the document, nested inside
  whatever the product scrolls. A shell owns a background, a border, padding and
  an overflow; a theme owns the same four; one element wearing both roles is an
  argument with no way to settle it. `mount()` writes the class and
  `data-dotmd-schema` onto the element it renders into, rather than leaving a
  consumer to remember — a forgotten class breaks nothing and merely leaves the
  document unstyled.
- **Four layers, declared in `base.css`**: `dotmd.host` for the product's rules
  that reach in from outside and must lose, then `base`, `theme`, `product`.
  Layer order beats specificity, which is the point: a product resets with a `*`
  and a theme states a heading margin with two classes, and an unlayered `*`
  wins. The panel's own reset went into `dotmd.host` for exactly that. Nothing in
  the base sheet reads a value a theme has to have provided, so the order holds
  with the theme layer empty.
- **A theme carries both palettes, and a product's word beats the system's.**
  Light and dark are one theme — a document that changed its typography when the
  light did would be a different document twice a day — and
  `[data-dotmd-color-scheme]` is written after the media query and with a
  selector that outweighs it, so it wins on both counts rather than on file
  order.
- **Tokens are the public surface.** Every `--dotmd-*` has a default in
  `base.css` meaning "whatever the host says", so an unthemed document reads like
  the text around it. A product that wants the note to follow its own colours
  overrides them in `dotmd.product`; the clipper overrides the two faces alone,
  because a theme cannot name a font file it does not ship.
- **A class only where the element cannot say what it is.** A highlight is a
  `<mark>`, a heading an `<h2>`, a quotation a `<blockquote>`, and a second name
  for something that already has one is a second thing to keep in step. What gets
  a class is the formula, the gap, the task item and the root — and the task item
  because the alternative was `:has(> input[type="checkbox"])` in somebody's
  stylesheet, which is a structural query rather than a name: it cannot be
  versioned and a theme written against it has guessed. `DOTMD_SCHEMA_VERSION`
  moves when a name stops meaning what it meant, never when one is added.
- **Two themes, because one proves nothing.** `reader` is the clipper panel's
  document, extracted and checked back against it node for node; `paper` is
  deliberately unlike it in every direction the contract has to survive — a face,
  a rhythm in `em`, a background of its own, a highlight it draws itself, and its
  own values for two tokens the base sheet gives defaults to. Anything `paper`
  had needed from the base sheet, the markup or the product would have been a
  boundary in the wrong place.

## The dialect

- **`==highlight==` is a rule of this package**, exported on its own as well as
  registered by the renderer. No standard defines it — neither CommonMark nor GFM
  has a highlight — and the converter writes it because the file's destination
  understands it. A renderer without the extension showed a reader the four `=`
  characters just put into their own file, which reads as a defect in the capture.
  Any second reader of this Markdown (the clipper's fidelity oracle) imports the
  extension rather than writing a copy of it.
- **The parser profile is `MARKED_PROFILE`, in one place.** `breaks` because a
  capture's line breaks are the page's; `gfm` for what the converter writes;
  `html` because placeholders and contributed blocks travel as markup, and because
  a note may hold HTML its author typed. A second spelling drifts silently — the
  oracle would go on measuring a renderer nobody runs.

## Maths

- **A bare pair of dollars is what a price looks like.** `**$129.00**
  ~~$159.00~~`, an ordinary product card, was read as one formula from `129.00` to
  `159.00` with the asterisks between them drawn as mathematics. The three
  conditions are Pandoc's and they are about the dollars, not the body: an opening
  dollar is not followed by a blank, a closing one is not preceded by one, and a
  closing one is not followed by a digit. The last is what parts two amounts.
- **The delimiter behind `\lt` and `\gt` is not one of those blanks**, and this is
  the half of a pair whose other half is `escapeMathTags` in the converter.
  Markup a page drew inside a formula is defused there by LaTeX's own names for
  the brackets, each carrying the space LaTeX needs to tell the command from the
  letter behind it and eating it again when the formula is drawn. A formula the
  page ended with a tag therefore ends with that space, so Pandoc's second
  condition threw the whole formula away and the reader was shown `$\lt img
  src=x onerror=alert(1)\gt …$` — the file's own source — where the page had
  drawn markup. Those two commands and not every control word, though every one
  carries the same delimiter: `Price was $12 \approx $ last year` is a sentence
  about mathematics, and a general rule draws `12≈` and takes the year into the
  formula with it. Prose is untouched for the same reason the condition exists —
  the blank in `Costs $5 and $x` is one no backslash put there.
- **Those conditions are asked by a tokenizer, never by a pass over the note.** A
  regular expression over a Markdown document knows nothing about the document:
  the pass lost the contents of `` `$x$` ``, ate the escaped dollar in `Costs
  \$x$`, and replaced the variables in a fenced `echo $PATH$HOME` — a note about a
  shell, the commonest thing there is. A tokenizer is offered only what `marked`
  is willing to start a token with, so code spans, fences, indented blocks,
  autolinks and backslash escapes are opaque to it without one rule about them. A
  run of dollars that opens nothing is consumed as characters, which is what the
  old `(?<!\$)` guards bought.
- **`$$…$$` is asked at block level as well**, and that half is what a blank line
  needs: an inline tokenizer is only ever offered the text of one block. A
  `\begin{aligned}` with a blank line between two of its rows is ordinary LaTeX
  and was shown as two paragraphs of raw dollars. The inline half stays, because a
  mid-sentence `$$x$$` is a formula too. The first `$$` after the opener closes it
  and has to end its line: never a later one, or `$$a$$ and prose` above a second
  formula reads as one formula with the prose swallowed inside it.
- **What a token cannot reach is not drawn, and that is the price.** Raw HTML in
  the note is one `html` token `marked` passes through whole, so
  `<p>Energy $E=mc^2$</p>` shows its dollars — and `<pre>echo $PATH$HOME</pre>`,
  which the old pass rewrote from the inside, shows the listing. A blank line
  inside the tag reopens Markdown and the formula is drawn again. Two more the
  pass over the string used to reach: a `$…$` whose body holds `\$`, which no
  `$`-delimited syntax can express, and a `$$…$$` spread over the lines of one
  table cell, which is not a row GFM has. Nothing is lost in any of them — the
  characters are shown as written, which is the trade.
- **A formula travels as `<span data-katex="…">` holding an id, never the LaTeX,
  and never a `<div>`.** The id is why the LaTeX cannot become markup — it is kept
  aside and reaches the DOM only through `hydrateMath()`, after the sanitizer. A
  `<div>` would open an HTML block that swallows the rest of the paragraph, and
  the blank lines around it would close the HTML block of a fallback table whose
  cell holds the formula. It carries `.dotmd-math--display`, and `base.css` is
  what puts it back on a line of its own; the attribute that used to say so was
  a private spelling of a class the schema now declares.
- **The id carries a token drawn per render**, and the hydrator asks for that
  token rather than for `[data-katex]`. The ids were `0`, `1`, `2` in a
  module-wide map, and a note holding `<span data-katex="0">KEEP</span>` — markup
  its author typed, which `marked` passes through — had `KEEP` replaced by
  whatever formula was first in that render.
- **A `RenderResult` owns its formulas.** Nothing module-wide is left for a second
  render to clear, and a result can be mounted later, or twice: a reader who
  rendered again before mounting used to get the second document's formulas in the
  first document's placeholders.
- **A formula the typesetter refuses is written back out as `$…$`.** It is still a
  formula the file holds, and an empty span says nothing about what is missing.

## Content gaps

- **The gaps go in after the lexer has run, never by a pass over the note.**
  `\n{3,}` is a block boundary everywhere except inside a code block, where three
  newlines are three newlines somebody wrote — and by then the fence has claimed
  them. The pass turned a shell listing's blank lines into a spacer `<div>`.
- **The count is a boundary, not a token.** A paragraph leaves the blank lines as
  a `space` token; a blockquote keeps the first and leaves the rest; a heading, a
  table, a rule, an HTML block and an indented block swallow the lot into their
  own `raw`. Reading the `space` alone put the threshold one line out for
  everything in the second group. Blockquotes and lists are walked into: spacing
  the page left inside one is the page's spacing.

## Contributions

- **A product's block is a contribution, never `(md: string) => string`.** A free
  preprocessor is a second parser nobody declared — it can rewrite anything, in
  any order, including inside a fence, which is exactly how the maths pass this
  package replaced lost people's listings. A contribution states its stage, the
  range it consumes and the markup that stands in that range's place; the package
  does the replacing and sanitizes the result with the rest of the document.
- **`consumes` is global, and applied everywhere it matches.** A front matter
  block is not necessarily at the top of the file: a second capture is appended to
  a note that already has one, so the third block is in the middle of the text. A
  conventional front-matter parser would have lost every block but the first.
- **Both halves of a product's agreement stay in the product.** The clipper writes
  its front matter with `buildMetadata()` and reads it back with `METADATA_RE`;
  widening one without the other loses the block on exactly the notes that already
  exist. This package has no opinion about front matter and would have to grow one
  to hold either half.

## Plain text

- **`dotmdtohtml/plain-text` reads the note, never the rendered document.** A
  preview shortens a URL for a card, expands a contributed block into something
  else and replaces LaTeX with a drawing; text taken from it describes a screen
  rather than the file a person asked to export.
- **It is a subpath of its own** because it holds no formulas, no contributions
  and no element — and because it must still parse *this* dialect: without the
  highlight extension the text came out with four `=` characters in it, which is
  the file's syntax showing through the one output whose job is to have none.

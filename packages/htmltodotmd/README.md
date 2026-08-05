# HTML → .md

[![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

TypeScript/JavaScript library for converting HTML to Markdown. Zero dependencies. Works in any browser, Chrome Extension, or bundler (Vite, esbuild, webpack).

Its consumers are Chrome extensions that vendor this repository as a git
submodule and import it straight from source, with no build step between the two
— so the library and the products built on it never drift apart.

It is one of two packages in this repository. The other, `pagetodotmd`, reads a
*live* page — computed style, shadow trees, how many lines a row was drawn on —
and hands the result here; everything it records is declared under the
[`htmltodotmd/snapshot`](./src/snapshot.ts) subpath, which is the whole of the
protocol between them.

## Integration

Build `dist/browser.mjs` (see [Build from Source](#build-from-source)) and copy
it into your project. That's it — no build step on your side, no dependencies.

```js
import { toMarkdown } from './browser.mjs'

const md = toMarkdown('<h1>Hello</h1><p>World <strong>!</strong></p>')
// # Hello
//
// World **!**
```

TypeScript types are emitted next to it as `dist/browser.d.ts`.

## API

### `toMarkdown(input, options?)`

Converts an HTML string or DOM `Node` to Markdown.

```typescript
function toMarkdown(input: string | Node, options?: Options): string
```

```js
// From string
toMarkdown('<p>Hello <strong>world</strong></p>')
// → "Hello **world**\n"

// From a DOM node
const article = document.querySelector('article')
toMarkdown(article, { baseUrl: window.location.href })
```

### `selectionToMarkdown(selection, options?)`

Converts the user's current text selection to Markdown.

```typescript
function selectionToMarkdown(selection: Selection, options?: Options): string
```

```js
const selection = window.getSelection()
if (selection) {
  const md = selectionToMarkdown(selection, {
    baseUrl: window.location.href,
  })
  await navigator.clipboard.writeText(md)
}
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `baseUrl` | `string` | — | Resolve relative URLs in links and images |
| `math` | `boolean` | `false` | Convert KaTeX / MathJax / Wikipedia math |
| `footnotes` | `boolean` | `false` | Convert footnotes |
| `complexTableFallback` | `'flatten' \| 'html' \| 'text' \| 'skip'` | `'flatten'` | Tables GFM cannot express — merged cells, a nested table, a preformatted cell. `'flatten'` folds them into the pipe form: a merged cell keeps its text where it starts and leaves the positions it spanned empty, a nested table becomes its rows, preformatted text becomes one code span per line. `'html'` emits an HTML table instead, which keeps the structure exactly but stops every cell from being Markdown |
| `headingOffset` | `number` | `0` | Shift heading levels (`1` turns h1→h2, h2→h3…) |
| `topHeadingLevel` | `number` | — | Put the input's shallowest heading at this level and move the rest by the same amount, so a fragment that starts at `<h3>` reads as a document. `headingOffset` wins where both are given |
| `rules` | `Rule[]` | `[]` | Custom rules — override any element's conversion |

## Supported Elements

| HTML | Markdown |
|------|----------|
| `<h1>`–`<h6>` | `#`–`######` |
| `<p>` | Paragraph |
| `<br>` | Hard line break |
| `<hr>` | `---` |
| `<strong>`, `<b>` | `**bold**` |
| `<em>`, `<i>` | `*italic*` |
| `<del>`, `<s>` | `~~strikethrough~~` |
| `<code>` | `` `inline code` `` |
| `<pre><code>` | Fenced code block with language |
| `<a>` | `[text](url)` |
| `<img>` | `![alt](src)` |
| `<ul>` | `- item` |
| `<ol>` | `1. item` |
| `<li>` + checkbox | `[x]` / `[ ]` task list |
| `<blockquote>` | `> quote` |
| `<table>` | GFM pipe table |
| `<script>`, `<style>`, `<nav>`, `<footer>` | Removed |

## Custom Rules

Override any element's conversion or add support for new ones:

```js
const md = toMarkdown(html, {
  rules: [
    {
      name: 'mark',
      filter: 'mark',
      replacement: (_el, content) => `==${content}==`,
    },
    {
      name: 'callout',
      filter: (el) => el.tagName === 'DIV' && el.hasAttribute('data-callout'),
      replacement: (_el, content) => `> **Note:** ${content}`,
    },
  ],
})
```

Rules run in priority order: custom → math/footnotes → built-in → fallback.

## Chrome Extension

See [docs/CHROME_EXTENSION.md](./docs/CHROME_EXTENSION.md) for a complete integration guide.

## Build from Source

```bash
bun install        # once
bun run build      # outputs dist/browser.mjs and .d.ts
bun test           # the suite
bunx tsc --noEmit  # bun does not check types
```

## License

MIT

## Versioning

`0.2.0` changed `complexTableFallback` from `'html'` to `'flatten'`. A table GFM
cannot express — merged cells, a nested table, a preformatted cell — now folds
into the pipe form instead of becoming an HTML table. Pass
`complexTableFallback: 'html'` to keep the previous output.

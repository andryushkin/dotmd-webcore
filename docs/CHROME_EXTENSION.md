# Chrome Extension Integration Guide

This guide covers using `htmltodotmd` in a Manifest V3 Chrome Extension.

## Why this library

- **Browser-native** — ships `DOMParser`-based parsing with no server-side code; fits perfectly in a content script or offscreen document
- **Selection-aware** — `selectionToMarkdown()` is designed for exactly the "save user selection" use case
- **Tiny bundle** — < 15 KB gzip; won't bloat your extension

## Content Script: capture user selection

The simplest integration. A content script runs in the page context and has direct access to `window.getSelection()`.

**`content.ts`**

```typescript
import { selectionToMarkdown } from 'htmltodotmd';

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== 'CAPTURE_SELECTION') return;

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    sendResponse({ md: '' });
    return;
  }

  const md = selectionToMarkdown(selection, {
    baseUrl: window.location.href,  // resolve relative links
    headingOffset: 1,               // shift h1→h2 for fragment context
  });

  sendResponse({ md });
});
```

**Trigger from popup or background:**

```typescript
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const { md } = await chrome.tabs.sendMessage(tab.id!, { type: 'CAPTURE_SELECTION' });
await navigator.clipboard.writeText(md);
```

**`manifest.json` permissions:**

```json
{
  "permissions": ["clipboardWrite"],
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["content.js"]
  }]
}
```

## Background + Offscreen Document: convert arbitrary HTML

Service workers in Manifest V3 have no DOM. Use the [Offscreen API](https://developer.chrome.com/docs/extensions/reference/offscreen/) to run DOM-dependent code.

**`offscreen.html`**

```html
<!doctype html>
<html><body><script type="module" src="offscreen.js"></script></body></html>
```

**`offscreen.ts`**

```typescript
import { toMarkdown } from 'htmltodotmd';

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== 'CONVERT_HTML') return;
  const md = toMarkdown(msg.html as string, { baseUrl: msg.baseUrl });
  sendResponse({ md });
});
```

**`background.ts`**

```typescript
async function ensureOffscreen() {
  const existing = await chrome.offscreen.hasDocument?.();
  if (!existing) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: [chrome.offscreen.Reason.DOM_PARSER],
      justification: 'Convert HTML to Markdown',
    });
  }
}

export async function convertHtml(html: string, baseUrl: string): Promise<string> {
  await ensureOffscreen();
  const { md } = await chrome.runtime.sendMessage({
    type: 'CONVERT_HTML',
    html,
    baseUrl,
  });
  return md;
}
```

## Bundling

The correct entry point (`browser.mjs` vs `server.mjs`) is selected automatically via `package.json` export conditions.

### Vite (recommended)

No configuration needed — Vite resolves the `"browser"` condition automatically.

```typescript
// vite.config.ts — just build normally
import { defineConfig } from 'vite';
export default defineConfig({ build: { target: 'chrome114' } });
```

### webpack

```javascript
// webpack.config.js
module.exports = {
  resolve: {
    conditionNames: ['browser', 'module', 'main'],
  },
};
```

### esbuild

```javascript
require('esbuild').build({
  conditions: ['browser'],
  // ...
});
```

## Options for Chrome Extension use cases

### `headingOffset`

When capturing a fragment of a page, the fragment may start with `<h1>` even though it is not a top-level document heading. Use `headingOffset` to shift all heading levels down:

```typescript
selectionToMarkdown(selection, { headingOffset: 1 });
// h1 → h2, h2 → h3, ...
```

### `baseUrl`

Resolves relative links and image `src` attributes to absolute URLs, so saved Markdown stays valid when opened outside the original page:

```typescript
selectionToMarkdown(selection, { baseUrl: window.location.href });
```

### Custom rules

Add site-specific transformations. For example, strip annotation markers from a specific site:

```typescript
import { selectionToMarkdown } from 'htmltodotmd';

const md = selectionToMarkdown(selection, {
  baseUrl: window.location.href,
  rules: [
    {
      name: 'remove-annotation',
      filter: (el) => el.classList.contains('annotation-marker'),
      replacement: () => '',
    },
  ],
});
```

### MathML with no LaTeX (`htmltodotmd/mathml`)

The math rules read LaTeX a page already carries — an `<annotation
encoding="application/x-tex">`, a `<script type="math/tex">`, Wikipedia's
`alttext`. A `<math>` carrying none of those converts as the glyphs its children
are (`a+b`), which is what arXiv, LaTeXML and any hand-written MathML give you.

Deriving LaTeX from the structure needs a converter, and this library takes no
dependencies. It declares the type and you supply the implementation:

```typescript
import { toMarkdown } from 'htmltodotmd';
import { createMathMLFallbackRule } from 'htmltodotmd/mathml';
import { MathMLToLaTeX } from 'mathml-to-latex';

const md = toMarkdown(fragment, {
  math: true,
  rules: [createMathMLFallbackRule((mathml) => MathMLToLaTeX.convert(mathml))],
});
```

The converter is synchronous, is given the serialized element (`outerHTML`) and
returns **bare** LaTeX — no `$` or `$$`, since only the rule knows whether the
page said display. Returning an empty or whitespace-only string is a refusal, and
so is throwing: either way the MathML converts as its glyphs rather than
vanishing. Supply no rule at all and you get the same glyph fallback.

The rule refuses a `<math>` the page states LaTeX for, and one a renderer drew a
visible half beside — a KaTeX, MathJax or Wikipedia formula is two records of one
thing, and writing both puts `$\frac{a}{b}$ab` where the reader saw one fraction.
Do not write a MathML rule of your own instead: rules you pass are consulted
*before* every rule in this library, so yours would claim those carriers first.

Pass it with `math: true`. Rules you supply run whatever that flag says, but the
half that silences the carrier beside a drawing is this library's own rule, which
`math: false` switches off — so with maths off the MathML converts beside the
drawing, exactly as it does when you supply no rule at all.

## Manifest V3 checklist

- [ ] Add `"clipboardWrite"` permission if writing to clipboard from content script
- [ ] Add `"offscreen"` permission if using the Offscreen API
- [ ] Include `offscreen.html` in extension files if using background conversion
- [ ] Use `import { toMarkdown } from 'htmltodotmd'` in offscreen context (has DOM)
- [ ] Use `import { selectionToMarkdown } from 'htmltodotmd'` in content scripts

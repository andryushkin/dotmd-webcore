/**
 * Which newlines in the page's source the reader saw as lines.
 *
 * A caption on Instagram is three lines inside one `<span>`, drawn with two
 * literal newlines and no markup at all: nothing in the fragment says "line
 * here", so without something rewriting those newlines into `<br>` the reader's
 * three lines arrive welded into one. Ordinary markup is indented, and the
 * newline between a `<p>` and its first word is nothing anybody was shown. Both
 * are the same character in the same kind of text node, and the tag around them
 * cannot tell them apart — the rule that tried came back from a plain indented
 * paragraph with a hard break and a leading space on every wrapped line.
 *
 * What tells them apart is the computed `white-space` of the element holding the
 * text: `pre`, `pre-wrap`, `pre-line` and `break-spaces` draw the line, `normal`
 * and `nowrap` collapse it into a space. A stylesheet is most of where that comes
 * from, so neither a tag list nor the `style` attribute can answer it — the
 * fixture's own case E4 states the rule ("source newlines collapse to visible
 * spaces") and was failing on the paragraph that introduces it.
 *
 * The property needs a live node and a layout engine, both of which exist here
 * and nowhere else in the product. `cloneRangeWithBr()` works on a fragment that
 * is already detached, so the verdict is taken while the originals are still
 * reachable and carried to the clone on an attribute, in three steps that are
 * separate for reasons of their own:
 *
 * 1. `elementsPreservingNewlines()` reads and writes nothing. `snapshotStyles()`
 *    reads too, and the first write of a capture invalidates the style Chrome
 *    has cached for the scope — so every read a capture makes has to come before
 *    every write, and this one cannot both read and mark.
 * 2. `markPreservedNewlines()` writes, and hands back the undo. Like every other
 *    mark the capture puts on the page it restores the page's own value rather
 *    than removing the attribute, and it belongs in a `finally`.
 * 3. `breakPreservedNewlines()` reads the mark off the clone, splits the text
 *    nodes it applies to, and takes the marks off the fragment — so the core is
 *    never handed the attribute at all.
 *
 * The mark is its own attribute and not a `white-space` declaration in
 * `data-s2md-style`, which was the alternative. That attribute is the core's
 * input, read by `elementStyle()` beside the page's own `style`, and the core
 * already has a whitespace model of its own — `PRESERVE_WS` in
 * `core/packages/htmltodotmd/src/core/sanitizer.ts`, keyed by tag. Handing it the property would put
 * two models of the same question on the two sides of one capture, free to
 * disagree: a run rewritten into `<br>` here and preserved there is the break
 * drawn twice. It would also state, in a published attribute, a property no rule
 * in the core reads. Nothing about the mark below survives the conversion: it is
 * consumed and stripped before `toMarkdown()` sees the fragment.
 */

import { preservesSourceWhitespace } from './engine.js';
import type { StyleReader } from './engine.js';
import type { ComputedStyleOf } from './style-snapshot.js';
import { DEFAULT_NAMESPACE, type CaptureNamespace } from './namespace.js';

/**
 * The mark, on an element whose own text nodes keep their newlines.
 *
 * `white-space` inherits, so the value is asked of the element the text sits in
 * directly and the mark needs no ancestor walk on the other side — a `<span>`
 * inside a `pre-wrap` `<div>` computes `pre-wrap` and is marked for itself.
 *
 * Presence is the whole of the mark, and a page that writes this name itself
 * would be read as one for the length of a capture — a break drawn where the
 * reader saw a space, and never a word lost. Its value is restored all the same.
 */
// The name is `namespace.hardBreak`, taken from the session and never spelled
// here: it lands on somebody else's live page, and two consumers writing it at
// once is what the namespace keeps apart (`namespace.ts`).

// The legacy keywords, which is what Chrome's computed `white-space` still is.
const PRESERVING = new Set(['pre', 'pre-wrap', 'pre-line', 'break-spaces']);

// CSS Text 4 splits that shorthand into `white-space-collapse` and `text-wrap`,
// and a page that sets the longhands can leave the shorthand with no single
// keyword to serialize as. `preserve-spaces` is deliberately absent: it keeps
// spaces and turns segment breaks into them, which is the collapsing answer.
const PRESERVING_COLLAPSE = new Set(['preserve', 'preserve-breaks', 'break-spaces']);

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/**
 * Subtrees where a `<br>` would be damage rather than a line.
 *
 * Two claims, and they are kept apart on purpose, because only one of them is
 * the core's to make.
 *
 * The first is: whatever the sanitizer leaves alone already draws its own
 * newlines, so rewriting one into a `<br>` would draw the break twice, or put a
 * tag inside a code sample. That is exactly `preservesSourceWhitespace()`, and it
 * is *asked* rather than restated — the five tags were spelled out here under a
 * comment naming the core's set, which is the shape a pair drifts in: a tag added
 * there and not here is the doubled break, and this side cannot see it happen.
 *
 * The second is this file's own and says nothing about whitespace: the rest hold
 * no prose for a break to belong to. The sanitizer removes `script` and `style`
 * whole, and a maths or `svg` subtree is read by a rule that wants its text
 * exactly as the renderer wrote it. Merging the two would push these tags into
 * the core's set, where they would stop the sanitizer collapsing the whitespace
 * inside them — a different question with a different answer.
 */
const NON_PROSE_TAGS = new Set([
  'script', 'style', 'svg', 'math', 'mjx-container', 'annotation',
]);

function tagOf(el: Element): string {
  return el.tagName.toLowerCase();
}

function isLiteral(el: Element): boolean {
  const tag = tagOf(el);
  return preservesSourceWhitespace(tag) || NON_PROSE_TAGS.has(tag);
}

/** Whether a computed style draws the newlines in the text it governs. */
export function preservesNewlines(read: StyleReader): boolean {
  const shorthand = read('white-space');
  if (shorthand !== undefined && PRESERVING.has(shorthand)) return true;
  const collapse = read('white-space-collapse');
  return collapse !== undefined && PRESERVING_COLLAPSE.has(collapse);
}

function insideLiteral(el: Element | null): boolean {
  for (let up = el; up; up = up.parentElement) {
    if (isLiteral(up)) return true;
  }
  return false;
}

/**
 * The elements under `roots` whose own newlines the reader saw as lines.
 *
 * Reads; writes nothing. `getComputedStyle` is asked only about an element that
 * holds a newline in a text node of its own, which on a page nobody styled that
 * way is the whole of what this costs — the answer is `false` and no attribute
 * is written at all.
 */
export function elementsPreservingNewlines(
  roots: Iterable<Element>,
  computed: ComputedStyleOf,
): Element[] {
  const out: Element[] = [];
  const seen = new WeakSet<Element>();

  const visit = (el: Element): void => {
    // Two roots where one contains the other, which `captureStyles` allows.
    if (seen.has(el)) return;
    seen.add(el);
    if (isLiteral(el)) return;

    let holdsNewline = false;
    for (let child = el.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === TEXT_NODE) {
        if ((child.nodeValue ?? '').includes('\n')) holdsNewline = true;
      } else if (child.nodeType === ELEMENT_NODE) {
        visit(child as Element);
      }
    }
    // A component's tree is not among its host's children, and
    // `mirrorShadowRoots()` copies it into the light DOM by `innerHTML` — which
    // carries attributes and nothing else, so a mark not written here can never
    // be written at all. Same reason `snapshotStyles()` walks it.
    const shadow = (el as Element & { shadowRoot?: { firstChild: ChildNode | null } | null })
      .shadowRoot;
    if (shadow) {
      for (let child = shadow.firstChild; child; child = child.nextSibling) {
        if (child.nodeType === ELEMENT_NODE) visit(child as Element);
      }
    }

    if (holdsNewline && preservesNewlines(computed(el))) out.push(el);
  };

  try {
    for (const root of roots) {
      // The walk prunes at a literal tag, but the root can already be inside one
      // — a selection made in a code sample is the ordinary way of getting there.
      if (insideLiteral(root.parentElement)) continue;
      visit(root);
    }
  } catch {
    /* whatever was read before the fault is still worth marking */
  }
  return out;
}

/**
 * Marks them, and hands back the undo.
 *
 * Nothing here throws out: a capture that failed over an attribute would be a
 * worse failure than the line breaks this improves, and the undo has to come
 * back even for a write that stopped half way, or the page keeps the mark.
 */
export function markPreservedNewlines(
  elements: Iterable<Element>,
  namespace: CaptureNamespace = DEFAULT_NAMESPACE,
): () => void {
  const attr = namespace.hardBreak;
  const undo: Array<() => void> = [];
  const restore = (): void => {
    for (let index = undo.length - 1; index >= 0; index -= 1) undo[index]!();
  };
  try {
    for (const el of elements) {
      // The page may own the name, so its value is put back rather than removed.
      const previous = el.getAttribute(attr);
      undo.push(
        previous === null
          ? () => el.removeAttribute(attr)
          : () => el.setAttribute(attr, previous),
      );
      el.setAttribute(attr, '');
    }
  } catch {
    /* `restore` already knows about every attribute that was written */
  }
  return restore;
}

/**
 * The verdict for the text nodes the clone strands at its top level.
 *
 * `cloneContents()` copies the children of the range's common ancestor, so a
 * selection made inside a paragraph — which is most selections — arrives as a
 * text node with no parent element and no mark to read. The element those nodes
 * came from is the common ancestor, and it is live and already marked, so the
 * answer costs one attribute read and no style at all.
 */
export function rangePreservesNewlines(
  range: Range,
  namespace: CaptureNamespace = DEFAULT_NAMESPACE,
): boolean {
  const container = range.commonAncestorContainer;
  const el = container.nodeType === ELEMENT_NODE
    ? (container as Element)
    : container.parentElement;
  return el !== null && el.getAttribute(namespace.hardBreak) !== null;
}

function textNodesOf(root: Node, out: Text[]): void {
  for (let child = root.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === TEXT_NODE) out.push(child as Text);
    else if (child.nodeType === ELEMENT_NODE) textNodesOf(child, out);
  }
}

/**
 * Rewrites into `<br>` the newlines the page drew, and only those.
 *
 * A `<br>` the page wrote itself is an element and is never touched: this reads
 * text nodes. Two author newlines in a row become two `<br>`, which
 * `collapseHardBreaksToParagraphs()` turns into the paragraph break the reader
 * saw.
 */
// The wrappers a run of text is written in, which a line runs straight through.
// Anything else — a `<div>`, a `<p>`, a list item — ends the line whatever its
// style says here, and a newline against its edge is the markup's indentation.
const INLINE_WRAPPERS = new Set([
  'span', 'a', 'em', 'strong', 'b', 'i', 'u', 's', 'del', 'ins', 'mark', 'small',
  'sub', 'sup', 'abbr', 'cite', 'q', 'time', 'label', 'bdi', 'bdo', 'font', 'font-face',
]);

// What the reader saw where the markup holds no text at all. A replaced element
// paints its own box — a picture, a player, a form control — and `textContent`
// says nothing about any of them, so a caption ending in a newline beside one
// read as "nothing drawn on that side" and lost the line the reader saw. Chrome
// draws every one of these; the core emits several of them and drops the rest,
// and a break with nothing left after it is already the blank line it was
// drawing (`docs/conversion.md`, `<br>`), so counting one costs no backslash.
const DRAWN_WITHOUT_TEXT = new Set([
  'img', 'picture', 'svg', 'canvas', 'video', 'audio', 'iframe', 'embed', 'object',
  'input', 'select', 'textarea', 'button', 'meter', 'progress', 'math', 'mjx-container',
]);

/** Whether this subtree painted anything, text or not. */
function drawsAnything(node: Node): boolean {
  if (node.nodeType !== ELEMENT_NODE) return (node.textContent ?? '').trim() !== '';
  const el = node as Element;
  // `br` is the line ending itself, and either way the question is answered.
  if (tagOf(el) === 'br' || DRAWN_WITHOUT_TEXT.has(tagOf(el))) return true;
  if ((el.textContent ?? '').trim() !== '') return true;
  // Only a subtree with no text at all is walked, which is what bounds this: a
  // wrapper is how a picture usually arrives — `<a><img></a>` is a linked one.
  for (let child = el.firstChild; child; child = child.nextSibling) {
    if (drawsAnything(child)) return true;
  }
  return false;
}

/**
 * Whether anything is drawn on that side of this node, within the run of text it
 * belongs to.
 *
 * Walks the siblings on that side and then out through inline wrappers only, so
 * the question stops at the first thing that would have ended the line anyway.
 */
function drawsBeside(node: Node, side: 'previousSibling' | 'nextSibling'): boolean {
  for (let current: Node | null = node; current; current = current.parentNode) {
    for (let sibling = current[side]; sibling; sibling = sibling[side]) {
      if (drawsAnything(sibling)) return true;
    }
    const parent = current.parentNode;
    if (parent === null || parent.nodeType !== ELEMENT_NODE) return false;
    if (!INLINE_WRAPPERS.has(tagOf(parent as Element))) return false;
  }
  return false;
}

export function breakPreservedNewlines(
  fragment: DocumentFragment,
  rootPreserves: boolean,
  namespace: CaptureNamespace = DEFAULT_NAMESPACE,
): void {
  const doc = fragment.ownerDocument;
  if (doc === null) return;

  // Collected before anything is replaced: the walk would otherwise arrive at
  // the text nodes this splits off and ask the same question about its own work.
  const texts: Text[] = [];
  textNodesOf(fragment, texts);

  for (const textNode of texts) {
    const text = textNode.nodeValue ?? '';
    if (!text.includes('\n')) continue;
    const parent = textNode.parentNode;
    const el = parent !== null && parent.nodeType === ELEMENT_NODE ? (parent as Element) : null;
    const preserves =
      el === null ? rootPreserves : el.getAttribute(namespace.hardBreak) !== null;
    if (!preserves) continue;

    const parts = text.split('\n');
    // Whitespace-only parts at the two ends are usually the break between the tag
    // and the text it holds. The reader did see them where the white-space
    // preserves them, but they fall at the edge of a block, where Markdown has
    // nothing to attach a hard break to and writes a bare backslash for it. Inner
    // empty parts stay: those are the blank line in a caption.
    //
    // Unless something is drawn on that side, which is the shape X writes a tweet
    // in: the paragraph break sits at the *end* of one `<span>` and the next
    // paragraph starts in the `<span>` beside it. Trimmed there, a 9,000-word
    // thread came back as a single paragraph — the edge of a node is not the edge
    // of a line.
    let start = 0;
    let end = parts.length;
    if (!drawsBeside(textNode, 'previousSibling')) {
      while (start < end - 1 && /^\s*$/.test(parts[start]!)) start += 1;
    }
    if (!drawsBeside(textNode, 'nextSibling')) {
      while (end > start + 1 && /^\s*$/.test(parts[end - 1]!)) end -= 1;
    }
    const effective = parts.slice(start, end);
    if (effective.length <= 1) continue;

    const out = doc.createDocumentFragment();
    effective.forEach((part, index) => {
      if (index > 0) out.appendChild(doc.createElement('br'));
      out.appendChild(doc.createTextNode(part));
    });
    textNode.replaceWith(out);
  }

  // The mark is the extension's, not the core's, and the core is handed this
  // fragment next.
  for (const marked of Array.from(fragment.querySelectorAll(`[${namespace.hardBreak}]`))) {
    marked.removeAttribute(namespace.hardBreak);
  }
}

/**
 * Collapses 2+ consecutive hard line breaks (`\<NL>` from `<br>`) into paragraph
 * breaks. Guards fenced code blocks where backslash-newline may be legitimate
 * (e.g. shell line continuations).
 */
export function collapseHardBreaksToParagraphs(md: string): string {
  const segments = md.split(/(^```[\s\S]*?^```$)/gm);
  return segments
    .map((seg, i) => {
      if (i % 2 === 1) return seg;
      return seg.replace(/(?:\\\n[ \t]*){2,}/g, '\n\n');
    })
    .join('');
}

/**
 * Where a selection inside a web component actually is.
 *
 * `Selection.getRangeAt()` answers in the document tree, and a selection made
 * inside an open shadow root is not there. Blink moves each endpoint of it to
 * the position of the shadow host before handing the range over, so a selection
 * lying wholly inside one component arrives as a range collapsed in front of the
 * host: `selection.toString()` still carries every word the reader highlighted,
 * the range carries nothing, and the capture writes an empty file. A selection
 * that starts in the page and ends inside a component loses its tail the same
 * way — the end moves back to the host, and everything the component drew is
 * left outside the range.
 *
 * `Selection.getComposedRanges({ shadowRoots })` answers in the composed tree:
 * the endpoints stay where the reader put them, in every shadow root the caller
 * can name. Chrome has had it since 137. Anything older keeps the document-tree
 * answer, which is what the extension already did — a capture that converts less
 * than it could is a defect, and a capture that throws is a worse one.
 *
 * Two limits of that API decide the shape of everything below.
 *
 * **A live `Range` cannot hold two trees.** `setEnd` with a node rooted
 * elsewhere collapses the range instead of spanning it, so a selection crossing
 * a shadow boundary cannot be handed to the conversion as one range. The
 * endpoint inside the component is lifted out to its host instead, and the range
 * covers that host whole — the copy `mirrorShadowRoots()` puts inside it is what
 * then carries the component's content, exactly as it does for a capture of the
 * whole element. That keeps the tail of a component the reader
 * stopped half way through, which is the side to err on: a sentence nobody asked
 * for is a blemish, a sentence that vanished is a loss the reader cannot see to
 * report.
 *
 * **It answers with one range, and a reader can hold several.** The spec has
 * `getComposedRanges()` returning zero or one, while a Cmd-drag can leave the
 * selection with more. Asking it about those would silently keep one range and
 * drop the rest, so a selection of more than one range keeps the document-tree
 * answer — which costs a component caught inside such a selection exactly what
 * it costs today, and costs the other ranges nothing.
 */

import { DEFAULT_NAMESPACE, type CaptureNamespace } from './namespace.js';

/** The `Node` constant, spelled out: neither a page's globals nor a test's. */
const ELEMENT_NODE = 1;

/** A tree can only nest so far before the lifting below is chasing a cycle. */
const MAX_LIFTS = 64;

/** What `getComposedRanges()` hands back — a `StaticRange`, read as four fields. */
export interface BoundaryPoints {
  readonly startContainer: Node;
  readonly startOffset: number;
  readonly endContainer: Node;
  readonly endOffset: number;
}

/**
 * The part of `Selection` a capture reads.
 *
 * Written out rather than taken from the DOM library because `getComposedRanges`
 * is the whole subject here and it is optional — a browser without it has to be
 * a value this module can be handed, not a branch nothing can reach.
 */
export interface CapturableSelection {
  readonly rangeCount: number;
  readonly isCollapsed: boolean;
  toString(): string;
  getRangeAt(index: number): Range;
  getComposedRanges?(options?: {
    shadowRoots?: readonly ShadowRoot[];
  }): readonly BoundaryPoints[];
}

/** One end of a range, before it is a range. */
interface Point {
  node: Node;
  offset: number;
}

/** The shadow root a node lives in, or `null` for a node in the page itself. */
function rootOf(node: Node): Node {
  return typeof node.getRootNode === 'function' ? node.getRootNode() : node;
}

/**
 * The element a shadow tree hangs from, for a node inside one.
 *
 * `null` for everything else, which is what makes it the test for "is this node
 * in a component at all" as well as the way out of one.
 */
export function shadowHostOf(node: Node): Element | null {
  const host = (rootOf(node) as Partial<ShadowRoot>).host;
  return host != null && host.nodeType === ELEMENT_NODE ? host : null;
}

/** How many components deep a node sits. */
function treeDepth(node: Node): number {
  let depth = 0;
  for (let host = shadowHostOf(node); host !== null; host = shadowHostOf(host)) {
    depth += 1;
    if (depth > MAX_LIFTS) break;
  }
  return depth;
}

function indexIn(parent: Node, child: Node): number {
  return Array.prototype.indexOf.call(parent.childNodes, child);
}

/**
 * Every open shadow root under `scope`, deepest first.
 *
 * A closed root is not here, and cannot be: `element.shadowRoot` is `null` for
 * one, so the extension can neither name it to `getComposedRanges()` nor copy
 * it. The browser answers such a selection with the host element instead, which
 * is the most a page that closed its component is willing to say — the capture
 * keeps whatever light DOM the host has and no more, rather than failing.
 *
 * The order is what `mirrorShadowRoots()` needs and costs nothing to anyone
 * else: a component inside a component has to be copied into the light DOM
 * before the tree it sits in is serialised, or the outer copy carries an empty
 * element where the inner one drew.
 */
export function openShadowRoots(scope: ParentNode): ShadowRoot[] {
  const found: Array<{ root: ShadowRoot; depth: number }> = [];
  const collect = (parent: ParentNode, depth: number): void => {
    if (depth > MAX_LIFTS) return;
    for (const el of Array.from(parent.querySelectorAll('*'))) {
      const root = el.shadowRoot;
      if (root === null) continue;
      found.push({ root, depth });
      collect(root, depth + 1);
    }
  };
  collect(scope, 0);
  return found.sort((a, b) => b.depth - a.depth).map((entry) => entry.root);
}

/** The point just outside the component this one sits in. */
function liftOut(point: Point, side: 'start' | 'end'): Point | null {
  const host = shadowHostOf(point.node);
  const parent = host?.parentNode;
  if (host === null || parent == null) return null;
  const index = indexIn(parent, host);
  if (index < 0) return null;
  return { node: parent, offset: side === 'start' ? index : index + 1 };
}

/**
 * The composed range as something the conversion can take.
 *
 * Both endpoints have to end up in one tree before a `Range` will hold them, so
 * whichever of them is deeper inside a component is lifted out to its host until
 * they meet. A selection wholly inside one shadow root never enters that loop
 * and reaches the conversion exactly as the reader drew it; a selection that
 * crosses a boundary comes out covering the host whole.
 */
function liveRange(points: BoundaryPoints, doc: Document): Range | null {
  let start: Point = { node: points.startContainer, offset: points.startOffset };
  let end: Point = { node: points.endContainer, offset: points.endOffset };
  if (start.node == null || end.node == null) return null;

  for (let lifts = 0; rootOf(start.node) !== rootOf(end.node); lifts += 1) {
    // Neither endpoint can be lifted any further and they still disagree: two
    // trees with no shadow host between them, which no range can span.
    if (lifts >= MAX_LIFTS) return null;
    const deeper = treeDepth(start.node) >= treeDepth(end.node);
    const lifted = deeper ? liftOut(start, 'start') : liftOut(end, 'end');
    if (lifted === null) return null;
    if (deeper) start = lifted;
    else end = lifted;
  }

  try {
    const range = (start.node.ownerDocument ?? doc).createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    return range;
  } catch {
    // An offset the tree no longer has — the page moved while the reader chose.
    return null;
  }
}

/**
 * The ranges a capture converts.
 *
 * The document-tree answer unless the composed one says more, and the composed
 * one is only asked where it can answer in full. Falling back rather than
 * throwing is the point: the same capture has to work on a browser that has
 * never heard of `getComposedRanges`.
 */
export function selectionRanges(
  selection: CapturableSelection,
  shadowRoots: readonly ShadowRoot[],
  doc: Document,
): Range[] {
  const light: Range[] = [];
  for (let i = 0; i < selection.rangeCount; i += 1) light.push(selection.getRangeAt(i));

  if (selection.rangeCount > 1) return light;
  if (typeof selection.getComposedRanges !== 'function') return light;

  let composed: readonly BoundaryPoints[];
  try {
    composed = selection.getComposedRanges({ shadowRoots }) ?? [];
  } catch {
    // An older shape of the API, or one that dislikes a root it was handed.
    return light;
  }

  const ranges: Range[] = [];
  for (const points of composed) {
    const range = liveRange(points, doc);
    // A collapsed one is the retargeting again in another form, and choosing it
    // over the document-tree answer would trade a poor capture for no capture.
    if (range !== null && !range.collapsed) ranges.push(range);
  }
  return ranges.length > 0 ? ranges : light;
}

/**
 * The element the style snapshot has to start from for this range.
 *
 * `snapshotScope()` reads the range's common ancestor and gives up when it is
 * not an element with a parent. A selection across a component's own children
 * has the shadow root itself as that ancestor — a `DocumentFragment`, whose
 * `parentElement` is `null` — so the whole component would be snapshotted from
 * nowhere and arrive unstyled. The host answers for it: the snapshot walks into
 * `shadowRoot` from there, which is the same ground a capture of the whole
 * element already covers.
 */
export function styleScopeOf(range: Range, scope: Element | null): Element | null {
  return scope ?? shadowHostOf(range.commonAncestorContainer);
}

/**
 * Copies every open shadow tree into the light DOM for the length of a capture.
 *
 * A shadow tree is not among its host's children, so a range covering the host
 * clones an empty element. The copy goes inside the host, and the page the
 * reader is looking at must not move while it is there.
 *
 * **What draws a light child is a `<slot>`, and the copy has to be assigned to
 * none.** It used to be a `<s2md-shadow>` element with nothing said about its
 * slot, under a comment claiming that was enough. It is enough only for a
 * component whose shadow tree has no default `<slot>` — and a default slot takes
 * every unassigned light child, which is what the commonest web component there
 * is has. On one of those the copy was assigned, drawn, and the reader watched
 * the component's content appear twice for the length of the capture.
 *
 * So the copy asks for a named slot, and the name is refused if this root
 * declares one to match. Slot assignment is the browser's own answer and cannot
 * be verified away from one — happy-dom does not model it, which the tests here
 * say in their first line — so this is the rule stated rather than the effect
 * observed, and the last word is a real page in Chrome.
 *
 * A `<span>` rather than an element named for the extension, and for a second
 * reason: `createElement('s2md-shadow')` is a *hyphenated* name, so a page that
 * has registered a custom element by it runs its constructor — arbitrary page
 * code, executed by a capture, inside the host it is copying. A built-in tag
 * cannot be a custom element, so nothing of the page's runs.
 *
 * The two do **not** convert identically, and the difference is the reason to
 * prefer this one rather than something to apologise for. A `<span>` is in the
 * converter's `HANDS_CONTENT_BACK`, so the text on either side of it is read as
 * one run; an unknown tag is opaque, and `<p><x>a </x> b</p>` came out `a  b`
 * with two spaces where the reader saw one. A wrapper this capture invented
 * should be invisible to that question — the page did not write it, so it must
 * not change what the words either side of it look like. Pinned by a test in
 * `tests/shadow-selection.test.ts`, because the day someone makes this a custom
 * element again the double space comes back at every light/shadow seam.
 *
 * Only what a range in the document tree needs: a range that reaches into a
 * shadow tree reads the real nodes and never sees these copies, and a copy is
 * never inside the tree it was made from, so nothing can be captured twice.
 *
 * Returns the undo, and returns it even if a copy fails half way through —
 * until it runs the page is carrying elements it did not ask for.
 */
export function mirrorShadowRoots(
  roots: readonly ShadowRoot[],
  namespace: CaptureNamespace = DEFAULT_NAMESPACE,
): () => void {
  const planted: Element[] = [];
  const lifted: Array<{ node: Node; parent: Node; before: Node | null }> = [];
  const remove = (): void => {
    for (let index = planted.length - 1; index >= 0; index -= 1) planted[index]!.remove();
    // Backwards, so each node finds the sibling it was in front of already back
    // in place — restoring forwards would insert before a node still lifted.
    for (let index = lifted.length - 1; index >= 0; index -= 1) {
      const { node, parent, before } = lifted[index]!;
      parent.insertBefore(node, before);
    }
  };
  try {
    for (const root of roots) {
      const host = root.host;
      const doc = host?.ownerDocument;
      if (host == null || doc == null) continue;
      const slots = slotNamesIn(root);
      for (const node of unrenderedLightChildren(slots, host)) {
        lifted.push({ node, parent: host, before: node.nextSibling });
        host.removeChild(node);
      }
      const wrapper = doc.createElement('span');
      wrapper.setAttribute('slot', unclaimedSlot(slots, namespace.shadowSlot));
      // A label, not an instruction to delete: the copy *is* the component's
      // content, and stripping it from the clone would empty every capture of a
      // web component. It is here so the copy can be told from the page's own
      // markup by whoever reads the HTML a capture hands back, and so a second
      // consumer's copy can be told from this one's.
      wrapper.setAttribute(namespace.shadowMirror, '');
      wrapper.innerHTML = root.innerHTML;
      host.prepend(wrapper);
      planted.push(wrapper);
    }
  } catch {
    /* whatever was planted or lifted before the fault still has to come back */
  }
  return remove;
}

/** Every slot name this shadow tree declares; the default slot is `''`. */
function slotNamesIn(root: ShadowRoot): Set<string> {
  const slots = new Set<string>();
  for (const slot of root.querySelectorAll('slot')) slots.add(slot.getAttribute('name') ?? '');
  return slots;
}

/**
 * A slot name this shadow tree does not have, so nothing assigns the copy to it.
 *
 * A page is free to declare a slot by any name, including the one asked for
 * here, so the answer is checked rather than assumed — a component that happened
 * to use it would draw the copy, which is the defect this whole path avoids.
 */
function unclaimedSlot(slots: ReadonlySet<string>, wanted: string): string {
  if (!slots.has(wanted)) return wanted;
  for (let n = 1; n <= MAX_LIFTS; n += 1) {
    const name = `${wanted}-${n}`;
    if (!slots.has(name)) return name;
  }
  return `${wanted}-${Math.random().toString(36).slice(2)}`;
}

/**
 * The host's own children that the component never puts on screen.
 *
 * A light child is drawn only where a `<slot>` calls for it, and a component
 * with no matching slot renders none of it — which is exactly how a fallback is
 * written. GitHub's `<relative-time>` holds `Jul 24, 2026` in the light DOM for
 * a reader with no JavaScript and shows `3 days ago` from its shadow tree; with
 * the shadow copy planted beside the fallback, every date on the page came out
 * as `3 days agoJul 24, 2026`.
 *
 * The assignment is worked out from the slots rather than read off
 * `assignedSlot`, which is the browser's own answer and the right one — but only
 * a browser has it, and this module is also exercised under happy-dom, where the
 * property is `undefined` for assigned and unassigned children alike. The rule
 * itself is small enough to state: a node goes to the slot named by its `slot`
 * attribute, text and attribute-less elements to the unnamed one.
 *
 * Nothing is lifted when the shadow tree offers a matching slot: an unrendered
 * child costs a duplicated line, a rendered one lifted by mistake costs the
 * sentence it held.
 */
function unrenderedLightChildren(slots: ReadonlySet<string>, host: Element): Node[] {
  if (slots.size === 0 && host.childNodes.length === 0) return [];
  const out: Node[] = [];
  for (const node of Array.from(host.childNodes)) {
    // The numeric constant, not `Node.ELEMENT_NODE`: this module is imported by
    // tests running under happy-dom, where the global is not defined, and the
    // throw was swallowed by the fault handler around the whole mirroring —
    // leaving both the copies and the fallback text in place, which is the
    // defect this function exists to prevent.
    const named = node.nodeType === 1 /* ELEMENT_NODE */
      ? (node as Element).getAttribute('slot') ?? ''
      : '';
    if (!slots.has(named)) out.push(node);
  }
  return out;
}

/**
 * Whether there is anything here to capture.
 *
 * `isCollapsed` and `rangeCount` are answered in the document tree like
 * everything else, and a browser is free to report a selection inside a
 * component as collapsed there. The text is the one thing the retargeting never
 * takes away, so it is asked in addition — never instead, since a selection
 * holding only an image has no text and is still a capture.
 *
 * Asked in that order, and the order is not a preference: this runs on every
 * `selectionchange`, which a drag fires on every mouse move, and `toString()`
 * builds the whole of the selected text each time it is called. The two cheap
 * fields answer for every ordinary selection before it comes to that.
 */
export function hasCapturableSelection<T extends CapturableSelection>(
  selection: T | null,
): selection is T {
  if (selection === null) return false;
  if (selection.rangeCount > 0 && !selection.isCollapsed) return true;
  return selection.toString().trim() !== '';
}

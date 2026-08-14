/**
 * The attribute names one capture writes on the page it is reading.
 *
 * A capture is a *write* to somebody else's document. It records the computed
 * style, the rows it measured, the newlines the reader saw as lines, and the
 * marks that let a clone be matched back to the node it came from — all of it as
 * attributes on live elements, all of it undone in a `finally`. While it is on,
 * those names are occupied.
 *
 * They used to be eight string literals spelled in five files, all of them
 * beginning `data-s2md-`, which was fine while one extension existed. It is not
 * fine with two: a reader and a clipper on the same page write the same names to
 * the same elements, and whichever restores second puts back what it read *after*
 * the other had already written — so the page keeps an attribute nobody owns, or
 * loses one it owned itself.
 *
 * Hence a value: the names of one session, settled when it starts and readable
 * by nothing else. Deliberately **not** a `configureNamespace()` that a consumer
 * calls once — a module-level setting is exactly the thing two consumers in one
 * realm take turns overwriting, and the failure would be silent and remote from
 * the call that caused it. There is nothing here to set.
 *
 * The prefix is a consumer's, not a session's, and that is not a compromise: the
 * own-UI mark is written when a consumer draws its bubble, minutes before any
 * capture exists, so a name minted per session could not have been on it. What a
 * session owns is the *object* — frozen, passed down explicitly, impossible to
 * hand to one path and forget on another.
 */
import { SNAPSHOT_ATTR, ROW_ATTR } from './engine.js';

/** Every name one capture session writes on the page it reads. */
export interface CaptureNamespace {
  /**
   * The computed style, recorded for a clone that has no layout engine behind
   * it. Read by `htmltodotmd`, which is why the default is its own name. A
   * consumer that chooses another one owes `canonicalize()` below a call before
   * the clone reaches `toMarkdown`, and the capture makes it.
   */
  readonly style: string;
  /** The mark on a container whose children the reader met side by side. */
  readonly row: string;
  /** The mark on an element whose text nodes keep the newlines they were written with. */
  readonly hardBreak: string;
  /** Ties a clone back to the element it was cut from: a table, an ordered list. */
  readonly origin: string;
  /** The same, for the one row a table's conversion prints as its header. */
  readonly originRow: string;
  /** What the snapshot read, written out beside its verdict when asked. */
  readonly diagnostic: string;
  /** The mark a consumer puts on the elements it drew itself. */
  readonly ownUI: string;
  /** The mark on a shadow tree copied into the light DOM for the length of a capture. */
  readonly shadowMirror: string;
  /**
   * The `slot` the mirror claims.
   *
   * A copy planted in the light DOM is drawn wherever a `<slot>` calls for it,
   * and a component with a default `<slot>` calls for every unassigned child —
   * which is most web components. The mirror therefore asks for a slot by name,
   * and the planting refuses to use this one where the shadow tree happens to
   * declare it.
   */
  readonly shadowSlot: string;
}

/**
 * The names for a consumer that spells its attributes `<prefix>-…`.
 *
 * Frozen, because the whole point is that nothing can change a name under a
 * capture that is already running.
 */
export function captureNamespace(prefix: string): CaptureNamespace {
  return Object.freeze({
    style: `${prefix}-style`,
    row: `${prefix}-row`,
    hardBreak: `${prefix}-nl`,
    origin: `${prefix}-origin`,
    originRow: `${prefix}-origin-row`,
    diagnostic: `${prefix}-debug`,
    ownUI: `${prefix}-ui`,
    shadowMirror: `${prefix}-shadow`,
    shadowSlot: `${prefix}-shadow`,
  });
}

/**
 * The prefix both of this family's extensions have always used.
 *
 * Kept as the default rather than replaced, because a page in the wild may carry
 * one of these attributes for its own reasons and the restore-don't-remove rule
 * was written for exactly that; changing the spelling would move the hazard
 * rather than remove it, and the shipped clipper has been writing these names
 * for its whole life.
 */
export const DEFAULT_PREFIX = 'data-s2md';

/** The default session names. `style` and `row` are the converter's own. */
export const DEFAULT_NAMESPACE: CaptureNamespace = Object.freeze({
  ...captureNamespace(DEFAULT_PREFIX),
  // Not `${prefix}-style`, though it spells the same: the converter declares
  // these two and this side imports them, so a rename there is a rename here and
  // not a silent disagreement. That is the pair the invariant sheets record.
  style: SNAPSHOT_ATTR,
  row: ROW_ATTR,
});

/**
 * Marks an element as the consumer's own paint, and hands it back.
 *
 * A product draws things into the page it is reading — a bubble, a hover
 * outline, a toast, the host of an overlay — and every one of them sits in the
 * document like any other element. A Cmd+A capture covers them: the clipper
 * shipped `add to .md` at the end of every full-page capture it made, and a
 * second copy inside two seconds put `Copied!` in the file as well. The capture
 * drops what is registered here (`[namespace.ownUI]`), which is the half a list
 * of selectors could never get right — such a list names the two elements
 * somebody remembered.
 *
 * The register is a **mark on the element**, not a set of nodes, for two reasons
 * that point the same way. `dropOwnUI` is handed a *clone*, and `cloneContents()`
 * keeps no link back to the originals, so a set of live nodes could not be
 * matched against a fragment at all while an attribute is copied along with
 * everything else. And a mark holds nothing: a toast is gone from the page two
 * seconds after it appears, and a register keeping its own reference would keep
 * every toast a session ever drew. Nothing is unregistered, because there is
 * nowhere for a dead node to be left.
 *
 * The namespace is a parameter, and the default is this package's own. It is the
 * one name a *consumer* owns rather than a session — a bubble is drawn minutes
 * before any capture exists, so a name minted per session could never have been
 * on it — and two products reading the same document must not share it: a bubble
 * marked `data-s2md-ui` is dropped by nobody when the capture walking the page
 * looks for `data-dotmd-wr-ui`, and the reader's own chrome re-enters the
 * document it is reading. A consumer with a namespace of its own passes it here,
 * the same object it will pass to the capture.
 *
 * Never removed while the element is on the page: the mark states what the paint
 * *is*, for its whole life, not what a capture is doing to it right now.
 */
export function registerOwnUI<T extends Element>(
  el: T,
  namespace: CaptureNamespace = DEFAULT_NAMESPACE,
): T {
  el.setAttribute(namespace.ownUI, '');
  return el;
}

/**
 * Puts the two names the converter reads back the way the converter spells them.
 *
 * The collision this whole module exists for happens on the **live page**, where
 * two consumers write at once. It cannot happen on the fragment handed to
 * `toMarkdown`: that is a detached clone, private to one capture, which nothing
 * else can reach. So the boundary is here — the page speaks the session's
 * dialect, the clone speaks the converter's.
 *
 * A rename at the seam rather than a name threaded into the converter, and the
 * reason is not convenience. `laysARow`, `drawnOnOneLine` and `statesConversion`
 * are asked from the parser, the sanitizer, the flanking walk and four rules,
 * most of them with no options object in hand; making the name a parameter would
 * put a plumbing argument through the engine's hottest path to say something the
 * clone can never disagree about. One selector over a fragment says it once.
 *
 * Costs nothing at all in the ordinary case: a consumer on the default namespace
 * writes the converter's own names, the two comparisons below are `===`, and the
 * function returns without touching the tree.
 */
export function canonicalize(fragment: ParentNode, namespace: CaptureNamespace): void {
  rename(fragment, namespace.style, SNAPSHOT_ATTR);
  rename(fragment, namespace.row, ROW_ATTR);
}

function rename(fragment: ParentNode, from: string, to: string): void {
  if (from === to) return;
  const all = fragment.querySelectorAll?.bind(fragment);
  if (all === undefined) return;
  // The page's own copy of the converter's name goes first, and it has to: this
  // capture did not write it, so nothing here knows what it means, and leaving it
  // would have the converter read a page's private attribute as a style *this*
  // capture recorded. On the default namespace the two names are one and the
  // snapshot's own restore-don't-remove rule covers it; the moment they differ,
  // that rule is covering a different name and this is the only guard left.
  for (const el of Array.from(all(`[${to}]`))) el.removeAttribute(to);
  for (const el of Array.from(all(`[${from}]`))) {
    const value = el.getAttribute(from);
    el.removeAttribute(from);
    if (value !== null) el.setAttribute(to, value);
  }
}

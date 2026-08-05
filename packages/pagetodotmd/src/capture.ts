/**
 * The capture itself: a selection, or a list of picked-out elements, into
 * Markdown.
 *
 * This is the order, and the order is the reason this file is in a package
 * rather than in one extension's content script. Read the computed style →
 * mirror the shadow trees → clone → convert → undo, the undo in two nested
 * `finally` blocks. Each step is where it is because of something that broke:
 * the style has to be read before any DOM change, because a change throws away
 * the cache Chrome answers `getComputedStyle` from; the mirroring has to happen
 * after that read and before the clone, because a shadow tree is not among its
 * host's children; the cleanup has to sit in a `finally` outside the conversion,
 * because the clone is taken while the attributes are still on and the page must
 * get them all back whatever the conversion does.
 *
 * None of that is recoverable from the result. A second product writing its own
 * capture would get a working one on the first page it tried and a subtly wrong
 * one everywhere else — which is why the sequence lives here, and why a consumer
 * hands over its *policy* (a conversion profile, the elements it drew itself, a
 * heading base carried between presses) rather than reimplementing the sequence
 * around it.
 *
 * Nothing here touches an extension API. Everything it needs — the document, the
 * selection, the window whose `getComputedStyle` answers — arrives as an
 * argument, which is what lets a test drive it and what lets two products share
 * it.
 */
import { toMarkdown, enrichRange, offsetForTop, topHeadingLevelAcross } from './engine.js';
import type { MarkItDownOptions } from './engine.js';
import {
  computedStyleIn,
  contentRectsIn,
  snapshotScope,
  snapshotScopeOf,
  snapshotStyles,
} from './style-snapshot.js';
import {
  breakPreservedNewlines,
  collapseHardBreaksToParagraphs,
  elementsPreservingNewlines,
  markPreservedNewlines,
  rangePreservesNewlines,
} from './hard-breaks.js';
import { joinFragments } from './join-fragments.js';
import {
  mirrorShadowRoots,
  openShadowRoots,
  selectionRanges,
  styleScopeOf,
} from './shadow-selection.js';
import { DEFAULT_NAMESPACE, canonicalize, type CaptureNamespace } from './namespace.js';

/** What one capture is asked for. Everything here is the consumer's policy. */
export interface CaptureOptions {
  /**
   * What the conversion is asked for — the consumer's profile and whatever rules
   * it can back.
   *
   * Handed over whole rather than assembled from flags here. Where a clip's
   * headings start, whether page furniture inside a selection survives, whether
   * a table GFM cannot express becomes HTML: each of those is argued from what a
   * person does with the file afterwards, and that argument belongs beside the
   * product that makes it. `baseUrl` is the exception and is filled in below,
   * because the document is this package's own input.
   */
  conversion?: MarkItDownOptions;
  /**
   * The attribute names this capture may write on the live page (`namespace.ts`).
   *
   * One frozen object for the whole capture, never a module-level setting: two
   * consumers reading the same document must not be able to change a name under
   * each other.
   */
  namespace?: CaptureNamespace;
  /**
   * Elements the consumer drew on the page itself, as selectors, dropped from
   * the clone.
   *
   * What a consumer registered is dropped without being asked — a registered
   * element carries a mark under `namespace.ownUI` — so this is only for what a
   * product knows by shape rather than by mark. The mark is what matters: a
   * bubble caught in a Cmd-A selection put `add to .md` at the end of every
   * full-page capture, and a toast that lives two seconds put `Copied!` in the
   * file of anyone who copied twice inside that window, while a list of ids named
   * the two elements somebody remembered.
   */
  exclude?: readonly string[];
  /**
   * Also hand back the markup the conversion was given.
   *
   * Off unless the reader asked for it: the fragment is the whole selection with
   * a computed style written onto every element that needed one, which on a long
   * article is larger than the Markdown it produces, and nothing in the ordinary
   * path reads it.
   */
  withHtml?: boolean;
  /**
   * Write down what the snapshot read beside each verdict. Defaults to
   * `withHtml`, because that markup is the only place it shows.
   */
  diagnostics?: boolean;
  /**
   * The shallowest heading level of what the consumer already holds for this page.
   *
   * A person captures a page in several goes, and each press is its own
   * conversion: capture the `<h2>` of a section, then the `<h3>` under it, and
   * both arrive at `##` because each answered the heading question alone. The
   * consumer remembers the level across presses and hands it back here, so the
   * second capture is shifted by what the first was shifted by.
   */
  headingBase?: number;
}

/** What one capture produced: the file, and — on request — its input. */
export interface Capture {
  md: string;
  /** The fragment handed to the converter, exactly as the converter saw it. */
  html?: string;
  /**
   * The shallowest heading level in this capture, before any shift — what the
   * consumer accumulates and hands back as `headingBase` next time. Absent where
   * the capture holds no heading at all.
   */
  topLevel?: number;
}

/**
 * The clone as text, taken before the conversion rather than after.
 *
 * `toMarkdown` sanitizes in place — hidden boxes removed, wrappers unwrapped,
 * whitespace collapsed — so a fragment serialized afterwards would be a report
 * about the sanitizer rather than about the page. What this shows is the input:
 * the reader's selection, carrying the style snapshot, which is what makes a
 * defect reproducible from the consumer's own interface.
 */
function serialize(fragment: DocumentFragment, doc: Document): string {
  const holder = doc.createElement('div');
  holder.appendChild(fragment.cloneNode(true));
  return holder.innerHTML;
}

/**
 * The conversion the consumer asked for, with the one value it cannot know.
 *
 * `baseUrl` resolves the page's relative links, and the page is what this
 * package was handed. A consumer that states one of its own is not overruled: a
 * harness converting a saved copy of a page knows the address it came from and
 * this does not.
 */
function conversionOptions(doc: Document, options: CaptureOptions): MarkItDownOptions {
  return { baseUrl: doc.baseURI, ...options.conversion };
}

/**
 * The heading shift, settled across the whole capture rather than per fragment,
 * and across the presses before it rather than this one alone.
 *
 * Two things cannot answer for themselves. A run over several picked-out
 * elements is many fragments, and each one asking on its own puts an `<h2>` and
 * the `<h3>` under it at the same rank. A second press of the button is a second
 * conversion, and the consumer appends its result to the first — so the level has
 * to come back out of here (`topLevel`) and back in next time (`headingBase`), or
 * a page captured in three goes comes back as three `##` with nothing under them.
 *
 * The probe is a copy: `sanitize()` edits what it is handed, and these fragments
 * are about to be converted for real. It is also what makes the answer the same
 * one `toMarkdown` would reach alone — a heading hidden from the reader is gone
 * by the time the level is read, on both paths.
 */
function sharedHeadingOffset(
  fragments: DocumentFragment[],
  opts: MarkItDownOptions,
  base: number | undefined,
): { options: MarkItDownOptions; topLevel: number | undefined } {
  const own = topHeadingLevelAcross(fragments, opts);
  const top = own === null ? (base ?? null) : Math.min(own, base ?? own);
  if (opts.topHeadingLevel === undefined || top === null) {
    return { options: opts, topLevel: own ?? undefined };
  }
  return {
    options: { ...opts, headingOffset: offsetForTop(top, opts.topHeadingLevel) },
    topLevel: own ?? undefined,
  };
}

// The numeric constants, never the `Node` global — the same spelling
// `shadow-selection.ts` keeps and for the same reason: this module is imported by
// tests running under happy-dom, where the global does not exist, and a
// `ReferenceError` here is swallowed by the fault handling around a capture. The
// tests had been lending the global back to work around it, which made the whole
// file's coverage conditional on a line nobody would think to copy.
const TEXT_NODE = 3;
const DOCUMENT_POSITION_FOLLOWING = 4;

// Expands a Range to whitespace boundaries when start/end land mid-token
// in text nodes (token = run of non-whitespace, includes letters/digits/
// punctuation). Element-boundary selections are left untouched.
const WORD_CHAR_RE = /\S/u;
export function expandRangeToWords(range: Range): Range {
  const out = range.cloneRange();
  const { startContainer, startOffset, endContainer, endOffset } = out;
  if (startContainer.nodeType === TEXT_NODE) {
    const text = startContainer.textContent ?? '';
    let i = startOffset;
    while (i > 0 && WORD_CHAR_RE.test(text[i - 1]!)) i--;
    if (i !== startOffset) out.setStart(startContainer, i);
  }
  if (endContainer.nodeType === TEXT_NODE) {
    const text = endContainer.textContent ?? '';
    let i = endOffset;
    while (i < text.length && WORD_CHAR_RE.test(text[i]!)) i++;
    if (i !== endOffset) out.setEnd(endContainer, i);
  }
  return out;
}

/**
 * What the consumer drew itself, out of the clone.
 *
 * They go out of the clone rather than being hidden on the page: hiding is a
 * mutation the reader would see, and the clone is ours to edit. Whole subtrees —
 * a bubble holds an icon and a label, and neither is page text.
 *
 * The mark travels with the clone, which is the whole reason the register is a
 * mark: `cloneContents()` keeps no link back to the originals, so a set of live
 * nodes could not be matched against a fragment at all.
 */
function dropOwnUI(
  fragment: ParentNode,
  namespace: CaptureNamespace,
  extra: readonly string[],
): void {
  for (const selector of [`[${namespace.ownUI}]`, ...extra]) {
    let found: Element[];
    try {
      found = Array.from(fragment.querySelectorAll(selector));
    } catch {
      // A selector a consumer got wrong leaves one element too many in the file;
      // it is not a reason to fail the capture.
      continue;
    }
    for (const el of found) el.remove();
  }
}

export function cloneRangeWithBr(range: Range, options: CaptureOptions = {}): DocumentFragment {
  const namespace = options.namespace ?? DEFAULT_NAMESPACE;
  // Read before the clone, not after: `cloneContents()` strands the children of
  // the common ancestor at the top of the fragment, where a text node has no
  // parent element left to carry the verdict (`hard-breaks.ts`).
  const rootPreserves = rangePreservesNewlines(range, namespace);
  // enrichRange, not cloneContents: a partial selection loses the context around
  // it — a table's header row, a code block's language, a list's numbering — and
  // restoring that is the converter's job. This path had been calling
  // cloneContents directly, so none of it reached the consumer.
  const fragment = enrichRange(range, namespace);
  dropOwnUI(fragment, namespace, options.exclude ?? []);
  breakPreservedNewlines(fragment, rootPreserves, namespace);
  // The page spoke this session's dialect; the converter speaks its own, and the
  // clone is where the two meet (`namespace.ts`). Free where they agree.
  canonicalize(fragment, namespace);
  return fragment;
}

/**
 * Records what the page's stylesheets say, for the length of one capture.
 *
 * Before anything else: `getComputedStyle` is answered from a cache Chrome throws
 * away on the next DOM change, and both `snapshotStyles()` and
 * `mirrorShadowRoots()` change the DOM. Reading first is what keeps a capture one
 * style recalculation rather than one per element.
 *
 * Two things are read here and both of them are read before either writes: which
 * newlines the page drew as lines (`hard-breaks.ts`) is a second question for the
 * same live nodes, and asking it after the snapshot had written its attributes
 * would buy the scope a style recalculation for nothing.
 *
 * The cleanup takes every attribute back off, so it belongs in a `finally`
 * outside the conversion — the clone is taken while they are still on.
 */
export function captureStyles(
  scopes: Array<Element | null>,
  doc: Document,
  options: CaptureOptions = {},
): () => void {
  const roots = scopes.filter((el): el is Element => el !== null);
  if (roots.length === 0) return () => {};
  const namespace = options.namespace ?? DEFAULT_NAMESPACE;
  // The document's own view first. `globalThis` rather than the bare `window`
  // this used to name: a package cannot assume the identifier exists, and a
  // `ReferenceError` here lands inside the fault handling around a capture,
  // where it arrives as an empty file rather than as an error.
  const view = doc.defaultView ?? (globalThis as unknown as Window);
  const computed = computedStyleIn(view);
  const preserving = elementsPreservingNewlines(roots, computed);
  // `snapshotStyles` swallows its own faults and always hands back a working
  // undo: a style the browser cannot resolve is a worse conversion, never a
  // failed capture, and never an attribute left on the page.
  // The second reading of the same live nodes, and the only one that is not a
  // style: how many lines a container's content was drawn on. It goes in beside
  // the computed style rather than after it for the reason the whole of this
  // function exists — both are answered from state the first DOM change throws
  // away, and both are read before anything writes.
  const restoreStyles = snapshotStyles(roots, computed, {
    diagnostics: options.diagnostics ?? options.withHtml ?? false,
    contentRects: contentRectsIn(doc),
    namespace,
  });
  const unmark = markPreservedNewlines(preserving, namespace);
  return () => {
    unmark();
    restoreStyles();
  };
}

export function selectionToMd(
  selection: Selection,
  doc: Document,
  options: CaptureOptions = {},
): string {
  return selectionToCapture(selection, doc, options).md;
}

export function selectionToCapture(
  selection: Selection,
  doc: Document,
  options: CaptureOptions = {},
): Capture {
  const namespace = options.namespace ?? DEFAULT_NAMESPACE;
  // Collected once and spent twice: the composed range has to be told which
  // shadow roots it may answer inside, and the copies below are made from the
  // same list — two walks would be two answers to the same question.
  const shadowRoots = openShadowRoots(doc);
  const ranges = selectionRanges(selection, shadowRoots, doc);
  const restoreStyles = captureStyles(
    ranges.map((range) => styleScopeOf(range, snapshotScope(range))),
    doc,
    options,
  );
  try {
    const cleanup = mirrorShadowRoots(shadowRoots, namespace);
    try {
      const opts = conversionOptions(doc, options);
      const markup: string[] = [];
      // Cloned first and converted after, because the heading shift is a question
      // about every fragment and `toMarkdown` consumes the one it is given.
      const clones = ranges.map((range) => {
        const fragment = cloneRangeWithBr(expandRangeToWords(range), options);
        if (options.withHtml) markup.push(serialize(fragment, doc));
        return fragment;
      });
      const shifted = sharedHeadingOffset(clones, opts, options.headingBase);
      const fragments = clones.map((fragment) =>
        collapseHardBreaksToParagraphs(toMarkdown(fragment, shifted.options)),
      );
      // Spread rather than `html: undefined`: absent and present-but-undefined
      // are different things to a caller that asks `'html' in capture`, and the
      // second is what a JSON round-trip through a message port drops anyway.
      return {
        md: joinFragments(fragments),
        ...(options.withHtml ? { html: markup.join('\n') } : {}),
        ...(shifted.topLevel === undefined ? {} : { topLevel: shifted.topLevel }),
      };
    } finally {
      cleanup();
    }
  } finally {
    restoreStyles();
  }
}

export function highlightsToMd(
  highlights: Iterable<Element>,
  doc: Document,
  options: CaptureOptions = {},
): Capture {
  const namespace = options.namespace ?? DEFAULT_NAMESPACE;
  const sorted = [...highlights].sort((a, b) => {
    const pos = a.compareDocumentPosition(b);
    return pos & DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  });

  const restoreStyles = captureStyles(
    sorted.map(el => snapshotScopeOf(el)),
    doc,
    options,
  );
  try {
    const cleanup = mirrorShadowRoots(openShadowRoots(doc), namespace);
    try {
      const opts = conversionOptions(doc, options);
      const markup: string[] = [];
      // Two passes for the reason `sharedHeadingOffset` states, and this is the
      // path that needs it: each picked-out element is its own fragment.
      const clones = sorted.map(el => {
        const range = doc.createRange();
        range.selectNodeContents(el);
        const fragment = cloneRangeWithBr(range, options);
        if (options.withHtml) markup.push(serialize(fragment, doc));
        return fragment;
      });
      const shifted = sharedHeadingOffset(clones, opts, options.headingBase);
      const fragments = clones.map(fragment =>
        collapseHardBreaksToParagraphs(toMarkdown(fragment, shifted.options)),
      );
      // Spread rather than `html: undefined`: absent and present-but-undefined
      // are different things to a caller that asks `'html' in capture`, and the
      // second is what a JSON round-trip through a message port drops anyway.
      return {
        md: joinFragments(fragments),
        ...(options.withHtml ? { html: markup.join('\n') } : {}),
        ...(shifted.topLevel === undefined ? {} : { topLevel: shifted.topLevel }),
      };
    } finally {
      cleanup();
    }
  } finally {
    restoreStyles();
  }
}

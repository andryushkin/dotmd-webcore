// The names one capture writes on somebody else's page.
//
// What is being held here is not the spelling — a spelling can be read off the
// module — but the two properties that make the object worth having: nothing can
// change a name under a running capture, and two consumers reading the same
// document write disjoint sets of attributes. The second is what the extensions
// need and what a module-level `configureNamespace()` could not have given.
import { describe, it, expect } from 'bun:test';
import { Window } from 'happy-dom';
import { SNAPSHOT_ATTR, ROW_ATTR, enrichRange, toMarkdown } from '../src/engine.js';
import {
  DEFAULT_NAMESPACE,
  DEFAULT_PREFIX,
  canonicalize,
  captureNamespace,
  registerOwnUI,
  type CaptureNamespace,
} from '../src/namespace.js';
import { highlightsToMd } from '../src/capture.js';
import { snapshotStyles } from '../src/style-snapshot.js';

function page(html: string): Document {
  const window = new Window();
  window.document.body.innerHTML = html;
  return window.document as unknown as Document;
}

/** Every name a session holds, so a new one cannot be added and forgotten here. */
const FIELDS = Object.keys(DEFAULT_NAMESPACE) as Array<keyof CaptureNamespace>;

describe('the capture namespace', () => {
  it('is frozen, so nothing can rename an attribute under a running capture', () => {
    const ns = captureNamespace('data-x');
    expect(Object.isFrozen(ns)).toBe(true);
    expect(() => {
      (ns as { style: string }).style = 'data-y-style';
    }).toThrow();
    expect(ns.style).toBe('data-x-style');
  });

  it('takes the two names the converter reads from the converter', () => {
    // Not `data-s2md-style` written out again: the pair is an import, so a
    // rename in the converter is a rename here rather than a silent
    // disagreement. Spelling it here would be the defect this replaces.
    expect(DEFAULT_NAMESPACE.style).toBe(SNAPSHOT_ATTR);
    expect(DEFAULT_NAMESPACE.row).toBe(ROW_ATTR);
  });

  it('gives two consumers disjoint names, every one of them', () => {
    const clipper = captureNamespace(DEFAULT_PREFIX);
    const reader = captureNamespace('data-mdread');
    for (const field of FIELDS) {
      expect(reader[field]).not.toBe(clipper[field]);
    }
    expect(FIELDS.length).toBeGreaterThan(5);
  });

  it('names nothing twice, so one undo cannot restore another mark', () => {
    // `shadowSlot` and `shadowMirror` are the exception and are meant to spell
    // the same: one is an attribute, one is a slot name, and they cannot collide
    // with each other.
    const attributes = FIELDS.filter((field) => field !== 'shadowSlot').map(
      (field) => DEFAULT_NAMESPACE[field],
    );
    expect(new Set(attributes).size).toBe(attributes.length);
  });
});

describe('registerOwnUI', () => {
  it('marks the element and hands back the very same node', () => {
    // The return value is what lets a consumer write
    // `parent.appendChild(registerOwnUI(bubble))`; a copy would leave the mark
    // on a node nobody appended.
    const doc = page('<div id="host"></div>');
    const bubble = doc.createElement('div');
    const back = registerOwnUI(bubble);
    expect(back).toBe(bubble);
    expect(bubble.hasAttribute(DEFAULT_NAMESPACE.ownUI)).toBe(true);
    expect(bubble.getAttribute(DEFAULT_NAMESPACE.ownUI)).toBe('');
  });

  it('writes the namespace it is given, and only that one', () => {
    const reader = captureNamespace('data-mdread');
    const doc = page('');
    const toast = registerOwnUI(doc.createElement('div'), reader);
    expect(toast.hasAttribute(reader.ownUI)).toBe(true);
    expect(toast.hasAttribute(DEFAULT_NAMESPACE.ownUI)).toBe(false);
  });

  it('is the half a capture under the same namespace already knows how to drop', () => {
    // The pairing, stated as the defect it prevents: a bubble registered under
    // one consumer's namespace is invisible to a capture walking another's, and
    // the paint reaches the file. Nothing throws when they disagree — the words
    // simply arrive at the end of the note.
    const reader = captureNamespace('data-mdread');
    const doc = page('<article><p>Body text.</p></article>');
    const article = doc.querySelector('article')!;
    const bubble = registerOwnUI(doc.createElement('div'), reader);
    bubble.textContent = 'add to .md';
    article.appendChild(bubble);

    const own = highlightsToMd([article], doc, { namespace: reader }).md;
    expect(own).toContain('Body text.');
    expect(own).not.toContain('add to .md');

    const stranger = highlightsToMd([article], doc, { namespace: DEFAULT_NAMESPACE }).md;
    expect(stranger).toContain('add to .md');
  });
});

describe('canonicalize', () => {
  it('does nothing at all on the default namespace', () => {
    const doc = page(`<p ${SNAPSHOT_ATTR}="font-weight:700" ${ROW_ATTR}="line">x</p>`);
    canonicalize(doc.body, DEFAULT_NAMESPACE);
    const p = doc.querySelector('p')!;
    expect(p.getAttribute(SNAPSHOT_ATTR)).toBe('font-weight:700');
    expect(p.getAttribute(ROW_ATTR)).toBe('line');
  });

  it('puts a session dialect back into the converter’s own two names', () => {
    const ns = captureNamespace('data-mdread');
    const doc = page(`<p ${ns.style}="font-weight:700" ${ns.row}="line">x</p>`);
    canonicalize(doc.body, ns);
    const p = doc.querySelector('p')!;
    expect(p.getAttribute(SNAPSHOT_ATTR)).toBe('font-weight:700');
    expect(p.getAttribute(ROW_ATTR)).toBe('line');
    expect(p.hasAttribute(ns.style)).toBe(false);
    expect(p.hasAttribute(ns.row)).toBe(false);
  });

  it('drops a page’s own copy of the converter’s name rather than reading it', () => {
    // The page wrote `data-s2md-style` for its own reasons and this capture
    // recorded nothing about that element. Kept, it would be read as a style the
    // capture had measured — a claim nobody made.
    const ns = captureNamespace('data-mdread');
    const doc = page(`<p ${SNAPSHOT_ATTR}="display:none">theirs</p>`);
    canonicalize(doc.body, ns);
    expect(doc.querySelector('p')!.hasAttribute(SNAPSHOT_ATTR)).toBe(false);
  });
});

describe('a second consumer’s marks are read, not only written', () => {
  // The sharp half of the namespace, and the one a test is worth: `enrichRange`
  // *reads* two of these names off the live common ancestor — is this box a row a
  // snapshot measured, does its style say anything the conversion reads — and a
  // consumer spelling them anything but the default used to get silence from
  // both. A drag across the sentence inside a flex row then came back as one
  // paragraph per item, which is the defect `wrapInRow` exists to prevent.
  const dragInsideTheRow = (ns: CaptureNamespace): string => {
    const doc = page(
      `<div ${ns.row}="line"><span>Wow even</span><div><a href="/x">@karpathy</a></div>` +
      '<span>admits it</span></div>',
    );
    const row = doc.querySelector('div')!;
    const range = doc.createRange();
    range.setStart(row.firstChild!, 0);
    range.setEnd(row.lastChild!, row.lastChild!.childNodes.length);
    const fragment = enrichRange(range, ns);
    canonicalize(fragment, ns);
    return toMarkdown(fragment as unknown as Node).trim();
  };

  it('keeps a row on one line for a consumer with a namespace of its own', () => {
    const mine = dragInsideTheRow(DEFAULT_NAMESPACE);
    const theirs = dragInsideTheRow(captureNamespace('data-mdread'));
    expect(theirs).toBe(mine);
    // And the answer is one line rather than a paragraph per item.
    expect(mine.split('\n\n')).toHaveLength(1);
  });
});

describe('a snapshot writes only its own session’s names', () => {
  const UA: (el: Element) => (property: string) => string | undefined = (el) => (property) =>
    property === 'font-weight' && el.tagName.toLowerCase() === 'b' ? '700' : undefined;

  it('leaves the other consumer’s attributes untouched, both ways', () => {
    const reader = captureNamespace('data-mdread');
    const doc = page('<div><b>heavy</b></div>');
    const b = doc.querySelector('b')!;
    // Somebody else's capture is mid-flight and has marked this element.
    b.setAttribute(DEFAULT_NAMESPACE.style, 'font-weight:400');

    const restore = snapshotStyles([doc.body], UA, { namespace: reader });
    try {
      expect(b.getAttribute(DEFAULT_NAMESPACE.style)).toBe('font-weight:400');
    } finally {
      restore();
    }
    // And the undo put back only what it wrote.
    expect(b.getAttribute(DEFAULT_NAMESPACE.style)).toBe('font-weight:400');
    expect(b.hasAttribute(reader.style)).toBe(false);
  });
});

// The optional way into a finished clone, and the two edits a consumer may run
// from it.
//
// With no `prepareClone`, every capture path is what it was — that is the
// clipper's default and is held by the suite as a whole (byte-for-byte under no
// hook). What this file can prove under happy-dom is the hook's contract: it
// fires once per fragment, on both capture paths, after own-UI is gone; a
// throw leaves the page as it was; `openDetails` sets the attribute the
// sanitizer reads; `materializeCurrentSrc` strips exactly its paired list and
// skips a placeholder. It cannot prove that a live `currentSrc` is the file
// the reader saw — under linkedom and happy-dom that property is `undefined`.
import { describe, it, expect } from 'bun:test';
import { Window } from 'happy-dom';
import {
  highlightsToMd,
  selectionToCapture,
  type PrepareCloneContext,
} from '../src/capture.js';
import {
  IMAGE_ADDRESS_ATTRS,
  collectCurrentSrc,
  imageAddressSignature,
  materializeCurrentSrc,
  openDetails,
} from '../src/clone-edits.js';
import { DEFAULT_NAMESPACE } from '../src/namespace.js';
import { toMarkdown } from '../src/engine.js';
// Deep import on purpose: the fold is not a public surface, and a rename that
// breaks this import is exactly the pair drift these tests exist to notice.
import { sanitize } from '../../htmltodotmd/src/core/sanitizer.js';
import type { CapturableSelection } from '../src/shadow-selection.js';

function page(html: string): Document {
  const window = new Window();
  window.document.body.innerHTML = html;
  return window.document as unknown as Document;
}

/** A single-range selection over the whole body, as a drag-select-all leaves. */
function selectBody(doc: Document): CapturableSelection {
  const range = doc.createRange();
  range.selectNodeContents(doc.body);
  return {
    rangeCount: 1,
    isCollapsed: false,
    toString: () => range.toString(),
    getRangeAt: () => range,
  };
}

describe('prepareClone', () => {
  it('is not called when the consumer did not hand one over', () => {
    const doc = page('<p>Hello</p>');
    // No prepareClone — and the capture still produces the paragraph. The
    // suite-wide "1741 without a hook" is the stronger byte-for-byte claim;
    // this only shows the option is optional.
    const capture = selectionToCapture(selectBody(doc) as unknown as Selection, doc);
    expect(capture.md.trim()).toBe('Hello');
  });

  it('fires once per fragment on a selection capture', () => {
    const doc = page('<p>One</p><p>Two</p>');
    const seen: DocumentFragment[] = [];
    selectionToCapture(selectBody(doc) as unknown as Selection, doc, {
      prepareClone(fragment) {
        seen.push(fragment);
      },
    });
    // One range → one fragment, even when the range holds two paragraphs.
    expect(seen).toHaveLength(1);
    expect(seen[0]!.textContent).toContain('One');
    expect(seen[0]!.textContent).toContain('Two');
  });

  it('fires once per picked-out element on the highlights path', () => {
    const doc = page('<p id="a">Alpha</p><p id="b">Beta</p>');
    const seen: string[] = [];
    highlightsToMd(
      [doc.querySelector('#a')!, doc.querySelector('#b')!],
      doc,
      {
        prepareClone(fragment) {
          seen.push((fragment.textContent ?? '').trim());
        },
      },
    );
    expect(seen).toEqual(['Alpha', 'Beta']);
  });

  it('sees the fragment after own-UI has already been dropped', () => {
    const ns = DEFAULT_NAMESPACE;
    const doc = page(
      `<p>Kept</p><div ${ns.ownUI}="">bubble</div><p>Also kept</p>`,
    );
    let text = '';
    selectionToCapture(selectBody(doc) as unknown as Selection, doc, {
      prepareClone(fragment) {
        text = fragment.textContent ?? '';
      },
    });
    expect(text).toContain('Kept');
    expect(text).toContain('Also kept');
    expect(text).not.toContain('bubble');
  });

  it('hands the document and the session namespace as context', () => {
    const doc = page('<p>x</p>');
    let context: PrepareCloneContext | undefined;
    selectionToCapture(selectBody(doc) as unknown as Selection, doc, {
      prepareClone(_fragment, ctx) {
        context = ctx;
      },
    });
    expect(context?.doc).toBe(doc);
    expect(context?.namespace).toBe(DEFAULT_NAMESPACE);
  });

  it('serializes withHtml after the hook, so the markup is what the converter saw', () => {
    const doc = page('<details><summary>Q</summary><p>A</p></details>');
    const capture = selectionToCapture(selectBody(doc) as unknown as Selection, doc, {
      withHtml: true,
      prepareClone(fragment) {
        openDetails(fragment);
      },
    });
    expect(capture.html).toContain('open');
    expect(capture.md).toContain('A');
  });

  it('a throwing hook does not fail the capture and leaves the page as it was', () => {
    // The restore pattern used across this package: remember the page, run the
    // capture, assert the page is byte-for-byte what it was (shadow-selection's
    // "takes every copy back off" is the same shape). happy-dom's computed
    // style does not make `<strong>` bold, so the claim is the words, not the
    // markers — the point is that the capture still finished.
    const doc = page('<p data-page="mine">Hello world</p>');
    const before = doc.body.innerHTML;
    const capture = selectionToCapture(selectBody(doc) as unknown as Selection, doc, {
      prepareClone() {
        throw new Error('consumer fault');
      },
    });
    expect(capture.md.trim()).toBe('Hello world');
    expect(doc.body.innerHTML).toBe(before);
  });

  it('a throwing hook on the highlights path restores the page too', () => {
    const doc = page('<p id="t">Target</p>');
    const before = doc.body.innerHTML;
    const capture = highlightsToMd([doc.querySelector('#t')!], doc, {
      prepareClone() {
        throw new Error('consumer fault');
      },
    });
    expect(capture.md.trim()).toBe('Target');
    expect(doc.body.innerHTML).toBe(before);
  });
});

describe('openDetails', () => {
  it('sets open on every details in the fragment, and the sanitizer then keeps the body', () => {
    const doc = page(
      `<details><summary>Q1</summary><p>Answer one</p></details>` +
        `<details open><summary>Q2</summary><p>Answer two</p></details>`,
    );
    const range = doc.createRange();
    range.selectNodeContents(doc.body);
    const fragment = range.cloneContents();

    // Before: a collapsed details loses its body to the sanitizer.
    const folded = fragment.cloneNode(true) as DocumentFragment;
    sanitize(folded);
    expect(folded.textContent).toContain('Q1');
    expect(folded.textContent).not.toContain('Answer one');
    expect(folded.textContent).toContain('Answer two');

    // After openDetails: both bodies survive.
    openDetails(fragment);
    for (const el of Array.from(fragment.querySelectorAll('details'))) {
      expect(el.hasAttribute('open')).toBe(true);
    }
    sanitize(fragment);
    expect(fragment.textContent).toContain('Answer one');
    expect(fragment.textContent).toContain('Answer two');
  });

  it('edits the clone only — the live page is untouched', () => {
    const doc = page('<details><summary>Q</summary><p>A</p></details>');
    const live = doc.querySelector('details')!;
    expect(live.hasAttribute('open')).toBe(false);
    const range = doc.createRange();
    range.selectNodeContents(doc.body);
    const fragment = range.cloneContents();
    openDetails(fragment);
    expect(fragment.querySelector('details')!.hasAttribute('open')).toBe(true);
    expect(live.hasAttribute('open')).toBe(false);
  });
});

describe('imageAddressSignature and collectCurrentSrc', () => {
  // bun test cannot prove that collectCurrentSrc's *values* are a browser's
  // real currentSrc — under linkedom / happy-dom the property is undefined, so
  // the map comes back with empty strings. What is held here is the keying.

  it('is the single spelling both collect and materialize use for the key', () => {
    const doc = page(
      `<img src="a.jpg" data-src="lazy-a.jpg" alt="A" />` +
        `<img src="b.jpg" data-src="lazy-b.jpg" alt="B" />`,
    );
    const map = collectCurrentSrc(doc.body);
    for (const img of Array.from(doc.querySelectorAll('img'))) {
      expect(map.has(imageAddressSignature(img))).toBe(true);
    }
    expect(map.size).toBe(2);
  });

  it('does not mutate the live root', () => {
    const doc = page('<img src="a.jpg" data-src="lazy.jpg" alt="A" />');
    const before = doc.body.innerHTML;
    collectCurrentSrc(doc.body);
    expect(doc.body.innerHTML).toBe(before);
  });

  it('collapses two images with identical address attributes to one entry', () => {
    // Same address set → same image to the reader → same currentSrc; a
    // collision is harmless by construction.
    const doc = page(
      `<img src="same.jpg" data-src="lazy.jpg" alt="one" />` +
        `<img src="same.jpg" data-src="lazy.jpg" alt="two" />`,
    );
    expect(collectCurrentSrc(doc.body).size).toBe(1);
  });
});

describe('materializeCurrentSrc', () => {
  // bun test cannot verify a live currentSrc: under linkedom / happy-dom
  // `img.currentSrc` is undefined. The tests below pass the value in through
  // the callback or a hand-built map, which is the whole point of the hand-off.

  it('writes the live currentSrc into src and strips exactly the paired address attributes', () => {
    const doc = page(
      `<img
        src="https://cdn.example.com/placeholder.jpg"
        data-src="https://cdn.example.com/lazy.jpg"
        data-original="https://cdn.example.com/original.jpg"
        data-lazy-src="https://cdn.example.com/lazy2.jpg"
        data-full-src="https://cdn.example.com/full.jpg"
        data-hi-res-src="https://cdn.example.com/hi.jpg"
        data-srcset="a.jpg 1x, b.jpg 2x"
        srcset="c.jpg 400w, d.jpg 800w"
        data-noscript-src="https://cdn.example.com/noscript.jpg"
        alt="Photo"
      />`,
    );
    const range = doc.createRange();
    range.selectNodeContents(doc.body);
    const fragment = range.cloneContents();
    const live = 'https://cdn.example.com/actual-400.webp';

    materializeCurrentSrc(fragment, () => live);

    const img = fragment.querySelector('img')!;
    expect(img.getAttribute('src')).toBe(live);
    for (const name of IMAGE_ADDRESS_ATTRS) {
      expect(img.hasAttribute(name)).toBe(false);
    }
    // Meaningful attributes under data-* that are not addresses stay.
    expect(img.getAttribute('alt')).toBe('Photo');
  });

  it('strips every name extractImageUrl reads — the list is the pair', () => {
    // If extractImageUrl gains a source and IMAGE_ADDRESS_ATTRS does not, this
    // is the test that should be extended with the new name. The constant is
    // the single spelling on this side. data-noscript-src is included even
    // though the sanitizer only writes it during conversion — see the list's
    // own comment.
    expect([...IMAGE_ADDRESS_ATTRS]).toEqual([
      'data-src',
      'data-original',
      'data-lazy-src',
      'data-full-src',
      'data-hi-res-src',
      'data-srcset',
      'srcset',
      'data-noscript-src',
    ]);
  });

  it('leaves the element alone when currentSrc is empty or a data: placeholder', () => {
    const markup =
      `<img src="keep-me.jpg" data-src="https://cdn.example.com/real.jpg" alt="A" />` +
      `<img src="keep-too.jpg" data-src="https://cdn.example.com/real2.jpg" alt="B" />` +
      `<img src="keep-three.jpg" data-src="https://cdn.example.com/real3.jpg" alt="C" />`;
    const doc = page(markup);
    const range = doc.createRange();
    range.selectNodeContents(doc.body);
    const fragment = range.cloneContents();
    const answers = [
      '',
      'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
      '   ',
    ];
    let i = 0;
    materializeCurrentSrc(fragment, () => answers[i++]);

    for (const img of Array.from(fragment.querySelectorAll('img'))) {
      // Unchanged: src still the original, data-src still present.
      expect(img.getAttribute('src')?.startsWith('keep')).toBe(true);
      expect(img.hasAttribute('data-src')).toBe(true);
    }
  });

  it('leaves a filename placeholder alone so data-src survives (paired with isPlaceholder)', () => {
    // The earlier isUsableCurrentSrc only refused data: URIs; the converter's
    // isPlaceholder also refuses loading/spacer/… names. Without the pair,
    // materialize wrote the placeholder into src, stripped data-src, and the
    // reader got a grey square.
    const doc = page(
      `<img src="loading.gif" data-src="https://cdn.example.com/real-photo.jpg" alt="A photo" />`,
    );
    const range = doc.createRange();
    range.selectNodeContents(doc.body);
    const fragment = range.cloneContents();
    materializeCurrentSrc(fragment, () => 'https://example.com/loading.gif');

    const img = fragment.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('loading.gif');
    expect(img.getAttribute('data-src')).toBe('https://cdn.example.com/real-photo.jpg');
    expect(toMarkdown(fragment as unknown as Node).trim()).toBe(
      '![A photo](https://cdn.example.com/real-photo.jpg)',
    );
  });

  it('src placeholder + data-src real: pending lazy load keeps the real address', () => {
    // currentSrc is still the markup src (absolute form); the loader has not
    // fired. materialize must not strip data-src — that is the picture the
    // document should hold. The toy name ph.gif does not match the placeholder
    // regex; the pending-lazy check is what saves it.
    const doc = page(
      `<figure><img src="ph.gif" data-src="real-photo.jpg" alt="A photo"></figure>`,
    );
    const range = doc.createRange();
    range.selectNodeContents(doc.body);
    const fragment = range.cloneContents();
    materializeCurrentSrc(fragment, () => 'https://example.com/ph.gif');

    const img = fragment.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('ph.gif');
    expect(img.getAttribute('data-src')).toBe('real-photo.jpg');
    expect(toMarkdown(fragment as unknown as Node).trim()).toBe(
      '![A photo](real-photo.jpg)',
    );
  });

  it('materializes when currentSrc has already adopted the lazy address', () => {
    // Loader fired: currentSrc is the real file. Write it and strip data-src so
    // extractImageUrl cannot prefer a stale lazy attribute over the live file.
    const doc = page(
      `<img src="ph.gif" data-src="real-photo.jpg" alt="A photo" />`,
    );
    const range = doc.createRange();
    range.selectNodeContents(doc.body);
    const fragment = range.cloneContents();
    materializeCurrentSrc(fragment, () => 'https://cdn.example.com/real-photo.jpg');

    const img = fragment.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('https://cdn.example.com/real-photo.jpg');
    expect(img.hasAttribute('data-src')).toBe(false);
    expect(toMarkdown(fragment as unknown as Node).trim()).toBe(
      '![A photo](https://cdn.example.com/real-photo.jpg)',
    );
  });

  it('does not strip unrelated data-* attributes', () => {
    const doc = page(
      `<img src="a.jpg" data-src="b.jpg" data-caption="a figure caption" data-id="42" />`,
    );
    const range = doc.createRange();
    range.selectNodeContents(doc.body);
    const fragment = range.cloneContents();
    materializeCurrentSrc(fragment, () => 'https://cdn.example.com/real.jpg');
    const img = fragment.querySelector('img')!;
    expect(img.getAttribute('data-caption')).toBe('a figure caption');
    expect(img.getAttribute('data-id')).toBe('42');
    expect(img.hasAttribute('data-src')).toBe(false);
  });

  it('is what makes extractImageUrl prefer the live file over data-src', () => {
    // Without the strip, writing src alone is a no-op for the converter: it
    // reads data-src first. This is the defect the function exists to prevent,
    // and the conversion is how a DOM-less suite can still see it.
    const doc = page(
      `<img src="placeholder.jpg" data-src="https://cdn.example.com/lazy.jpg" alt="X" />`,
    );
    const range = doc.createRange();
    range.selectNodeContents(doc.body);
    const raw = range.cloneContents();
    const fixed = range.cloneContents();
    materializeCurrentSrc(fixed, () => 'https://cdn.example.com/actual.webp');

    expect(toMarkdown(raw as unknown as Node).trim()).toBe(
      '![X](https://cdn.example.com/lazy.jpg)',
    );
    expect(toMarkdown(fixed as unknown as Node).trim()).toBe(
      '![X](https://cdn.example.com/actual.webp)',
    );
  });

  it('a map keyed by imageAddressSignature survives images dropped from the clone', () => {
    // The defect a document-order zip has: the live root holds furniture images
    // that dropOwnUI / exclude remove from the clone, and every image after the
    // first dropped one would get the next address. The signature key finds the
    // survivors by the attributes they still carry.
    const doc = page(
      `<img src="nav.jpg" data-src="nav-lazy.jpg" alt="furniture" />` +
        `<img src="hero.jpg" data-src="hero-lazy.jpg" alt="hero" />` +
        `<img src="icon.jpg" data-src="icon-lazy.jpg" alt="furniture" />` +
        `<img src="body.jpg" data-src="body-lazy.jpg" alt="body" />`,
    );
    // Hand-built map: under happy-dom currentSrc is undefined, so collect alone
    // cannot supply usable values. The keys are still imageAddressSignature —
    // the single spelling both halves use.
    const map = new Map<string, string>();
    for (const img of Array.from(doc.querySelectorAll('img'))) {
      map.set(
        imageAddressSignature(img),
        `https://cdn.example.com/${img.getAttribute('alt')}.webp`,
      );
    }

    const range = doc.createRange();
    range.selectNodeContents(doc.body);
    const fragment = range.cloneContents();
    // Drop the furniture the way exclude / own-UI would.
    for (const img of Array.from(fragment.querySelectorAll('img'))) {
      const alt = img.getAttribute('alt');
      if (alt === 'furniture') img.remove();
    }
    expect(fragment.querySelectorAll('img')).toHaveLength(2);

    materializeCurrentSrc(fragment, map);

    const [hero, body] = Array.from(fragment.querySelectorAll('img'));
    expect(hero!.getAttribute('src')).toBe('https://cdn.example.com/hero.webp');
    expect(body!.getAttribute('src')).toBe('https://cdn.example.com/body.webp');
    expect(hero!.hasAttribute('data-src')).toBe(false);
    expect(body!.hasAttribute('data-src')).toBe(false);
  });

  it('accepts the map collectCurrentSrc returns, keyed the same way', () => {
    const doc = page('<img src="a.jpg" data-src="lazy.jpg" alt="A" />');
    const collected = collectCurrentSrc(doc.body);
    // Override the empty happy-dom value so materialize has something to write;
    // the key is still whatever collect used.
    const key = imageAddressSignature(doc.querySelector('img')!);
    expect(collected.has(key)).toBe(true);
    collected.set(key, 'https://cdn.example.com/from-collect.webp');

    const range = doc.createRange();
    range.selectNodeContents(doc.body);
    const fragment = range.cloneContents();
    materializeCurrentSrc(fragment, collected);
    expect(fragment.querySelector('img')!.getAttribute('src')).toBe(
      'https://cdn.example.com/from-collect.webp',
    );
  });
});

/**
 * The join between a live page's fragment ids and the ids this package printed,
 * and the markup each class of link ends up with.
 *
 * What bun can prove: the join consumes duplicate titles in document order, a
 * non-heading target is never mapped, a same-document link is recognised from an
 * absolute address rather than from a leading `#`, and an unjoined internal link
 * is treated as one that leaves. What it cannot prove: that `target="_blank"`
 * actually opens a tab, and that scrolling lands where a reader expects — both
 * are a browser's, and both are in the consumer's manual matrix.
 */
import { describe, test, expect } from 'bun:test';
import { Window } from 'happy-dom';
import {
  buildHeadingFragmentMap,
  findById,
  wireDocumentLinks,
  type HeadingFragmentTarget,
} from '../src/index.js';
import type { FragmentTarget } from '../../pagetodotmd/src/fragment-ids.ts';

// The keep-in-sync pair from the repository CLAUDE.md, enforced by the
// compiler rather than by memory: `HeadingFragmentTarget` names two fields of
// `pagetodotmd`'s `FragmentTarget` structurally, and because `headingText` is
// optional, a rename over there would satisfy the shape while every internal
// link quietly stopped joining. This assignment stops compiling the moment
// either field's name or type drifts. Tests are the one place the two packages
// may see each other — nothing published gains a dependency edge.
const _fragmentTargetStaysAssignable: HeadingFragmentTarget = {} as Required<
  Pick<FragmentTarget, 'id' | 'headingText'>
>;
void _fragmentTargetStaysAssignable;

function container(html: string, url = 'https://example.com/article'): Element {
  const win = new Window({ url });
  const div = win.document.createElement('div');
  div.innerHTML = html;
  win.document.body.appendChild(div);
  return div as unknown as Element;
}

describe('buildHeadingFragmentMap', () => {
  test('joins an original id to the id the renderer printed, by text', () => {
    const fragmentIds: HeadingFragmentTarget[] = [
      { id: 'old-intro', headingText: 'Introduction' },
      { id: 'fig-1' }, // non-heading: must not map
      { id: 'old-outro', headingText: 'Introduction' }, // duplicate title
    ];
    const headings = [
      { level: 2, text: 'Introduction', id: 'introduction' },
      { level: 2, text: 'Introduction', id: 'introduction-1' },
    ];
    const map = buildHeadingFragmentMap(fragmentIds, headings);
    // Duplicates are consumed in document order rather than both claiming the
    // first heading — which is the whole reason the list is walked and not
    // indexed by text.
    expect(map.get('old-intro')).toBe('introduction');
    expect(map.get('old-outro')).toBe('introduction-1');
    expect(map.has('fig-1')).toBe(false);
  });

  test('falls back to the slug when the two texts drifted apart', () => {
    // The halves come from different trees — a live DOM and a token stream — so
    // whitespace drift is ordinary. The slug is the normal form both agree on;
    // the id still comes from the headings list, never from a suffix invented
    // here.
    const map = buildHeadingFragmentMap(
      [{ id: 'sec', headingText: '  The   Hard Case ' }],
      [{ level: 2, text: 'The hard case', id: 'the-hard-case' }],
    );
    expect(map.get('sec')).toBe('the-hard-case');
  });

  test('a text nothing in the render matches maps to nothing', () => {
    const map = buildHeadingFragmentMap(
      [{ id: 'gone', headingText: 'A section the capture dropped' }],
      [{ level: 1, text: 'Title', id: 'title' }],
    );
    expect(map.size).toBe(0);
  });
});

describe('wireDocumentLinks', () => {
  test('external blank, heading scrolls, non-heading stays a page link', () => {
    // Absolute addresses are what `resolveUrl` leaves behind: a bare `#` never
    // appears in converted markup, which is why nothing here tests for one.
    const root = container([
      '<h2 id="section-one">Section One</h2>',
      '<p><a id="ext" href="https://other.example/path">external</a></p>',
      '<p><a id="int-h" href="https://example.com/article#old-sec">to heading</a></p>',
      '<p><a id="int-fig" href="https://example.com/article#fig-1">to figure</a></p>',
    ].join(''));

    const scrolled: string[] = [];
    wireDocumentLinks(root, {
      documentUrl: 'https://example.com/article',
      baseURI: 'https://example.com/article',
      fragmentIds: [
        { id: 'old-sec', headingText: 'Section One' },
        { id: 'fig-1' },
      ],
      headings: [{ level: 2, text: 'Section One', id: 'section-one' }],
      documentRoot: root,
      onScrollTo: (id) => {
        scrolled.push(id);
      },
    });

    const ext = root.querySelector('#ext')!;
    expect(ext.getAttribute('target')).toBe('_blank');
    expect(ext.getAttribute('rel')).toContain('noopener');

    const intH = root.querySelector('#int-h')!;
    // The href is rewritten to the id the markup actually holds, so a copied
    // link is a working anchor rather than a promise this render cannot keep.
    expect(intH.getAttribute('href')).toBe('#section-one');
    expect(intH.getAttribute('target')).toBeNull();
    (intH as unknown as { click(): void }).click();
    expect(scrolled).toEqual(['section-one']);

    const intFig = root.querySelector('#int-fig')!;
    // A figure has no counterpart after the round trip: open the original page
    // rather than pretend to scroll somewhere.
    expect(intFig.getAttribute('target')).toBe('_blank');
    expect(intFig.getAttribute('rel')).toContain('noopener');
    expect(intFig.getAttribute('href')).toBe('https://example.com/article#fig-1');
  });

  test('same-document is decided by address, not by a leading hash', () => {
    // With a <base> pointing at a CDN, a raw `#id` resolves into another
    // document — which is why the comparison is on origin + path + query and
    // why `startsWith('#')` was never the test.
    const root = container(
      '<h1 id="title">Title</h1><p><a id="a" href="https://example.com/a/b#title-id">go</a></p>',
      'https://example.com/a/b',
    );
    wireDocumentLinks(root, {
      documentUrl: 'https://example.com/a/b',
      baseURI: 'https://cdn.example/assets/',
      fragmentIds: [{ id: 'title-id', headingText: 'Title' }],
      headings: [{ level: 1, text: 'Title', id: 'title' }],
      documentRoot: root,
      onScrollTo: () => {},
    });
    expect(root.querySelector('#a')!.getAttribute('href')).toBe('#title');
    expect(root.querySelector('#a')!.getAttribute('target')).toBeNull();
  });

  test('a same-origin link to another page leaves, hash or no hash', () => {
    const root = container([
      '<p><a id="other" href="https://example.com/elsewhere">elsewhere</a></p>',
      '<p><a id="self" href="https://example.com/article">this page, no fragment</a></p>',
    ].join(''));
    wireDocumentLinks(root, {
      documentUrl: 'https://example.com/article',
      fragmentIds: [],
      headings: [],
    });
    expect(root.querySelector('#other')!.getAttribute('target')).toBe('_blank');
    // Same address with nothing to scroll to: reloading the host under a modal
    // is worse than opening the page beside it.
    expect(root.querySelector('#self')!.getAttribute('target')).toBe('_blank');
  });

  test('a percent-encoded fragment names the id it decodes to', () => {
    const root = container(
      '<p><a id="a" href="https://example.com/article#caf%C3%A9">to café</a></p>',
    );
    wireDocumentLinks(root, {
      documentUrl: 'https://example.com/article',
      fragmentIds: [{ id: 'café', headingText: 'Café' }],
      headings: [{ level: 2, text: 'Café', id: 'café' }],
      onScrollTo: () => {},
    });
    expect(root.querySelector('#a')!.getAttribute('href')).toBe('#café');
  });

  test('a documentUrl that is not a URL leaves every link exactly as it was', () => {
    const root = container('<p><a id="a" href="https://other.example/x">x</a></p>');
    const before = root.innerHTML;
    wireDocumentLinks(root, { documentUrl: 'not a url', fragmentIds: [], headings: [] });
    expect(root.innerHTML).toBe(before);
  });

  test('without onScrollTo the default finds the heading and scrolls it', () => {
    const root = container([
      '<h2 id="section-one">Section One</h2>',
      '<p><a id="a" href="https://example.com/article#old-sec">go</a></p>',
    ].join(''));
    const heading = root.querySelector('#section-one')! as unknown as {
      scrollIntoView: (arg: unknown) => void;
    };
    const calls: unknown[] = [];
    heading.scrollIntoView = (arg) => {
      calls.push(arg);
    };
    wireDocumentLinks(root, {
      documentUrl: 'https://example.com/article',
      fragmentIds: [{ id: 'old-sec', headingText: 'Section One' }],
      headings: [{ level: 2, text: 'Section One', id: 'section-one' }],
    });
    (root.querySelector('#a') as unknown as { click(): void }).click();
    expect(calls).toEqual([{ block: 'start' }]);
  });
});

describe('findById', () => {
  test('finds a node under a root that is not a document', () => {
    // The case the three copies of this walk existed for: a rendered note inside
    // a shadow root, where `getElementById` does not reach.
    const root = container('<div><p id="deep">text</p></div>');
    expect(findById(root, 'deep')!.textContent).toBe('text');
  });

  test('the root itself answers, without asking what class it is', () => {
    const root = container('<p>text</p>');
    root.setAttribute('id', 'me');
    expect(findById(root, 'me')).toBe(root);
  });

  test('a document uses its own index and still finds the node', () => {
    const win = new Window({ url: 'https://example.com/' });
    win.document.body.innerHTML = '<p id="p">text</p>';
    const doc = win.document as unknown as Document;
    expect(findById(doc, 'p')!.textContent).toBe('text');
  });

  test('nothing under the root is null rather than a throw', () => {
    expect(findById(container('<p>text</p>'), 'absent')).toBeNull();
  });
});

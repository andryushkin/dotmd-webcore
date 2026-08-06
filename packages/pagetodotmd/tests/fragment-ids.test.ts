/**
 * Internal fragment map from a live document.
 *
 * The round trip loses ids; this is the map a consumer joins back by heading
 * text after `dotmdtohtml` prints slugs. No slug is computed here on purpose.
 */
import { describe, test, expect } from 'bun:test';
import { Window } from 'happy-dom';
import { collectFragmentIds } from '../src/fragment-ids.js';

function page(html: string, url = 'https://example.com/статья'): Document {
  const window = new Window({ url });
  window.document.write(html);
  return window.document as unknown as Document;
}

describe('collectFragmentIds', () => {
  test('bare hash and absolute same-document URL both count as internal', () => {
    const doc = page(`
      <h1 id="intro">Introduction</h1>
      <p id="note">A footnote target.</p>
      <a href="#intro">to intro</a>
      <a href="https://example.com/статья#note">to note</a>
    `);
    const targets = collectFragmentIds(doc);
    expect(targets.map((t) => t.id).sort()).toEqual(['intro', 'note']);
    const intro = targets.find((t) => t.id === 'intro')!;
    expect(intro.tag).toBe('h1');
    expect(intro.headingText).toBe('Introduction');
    const note = targets.find((t) => t.id === 'note')!;
    expect(note.tag).toBe('p');
    expect(note.headingText).toBeUndefined();
  });

  test('a fragment resolved through <base> to another origin is not internal', () => {
    const doc = page(`
      <base href="https://cdn.example/assets/">
      <h1 id="s">Title</h1>
      <a href="#s">looks local</a>
      <a href="https://example.com/статья#s">really local</a>
    `);
    const targets = collectFragmentIds(doc);
    // #s resolved against the CDN base — not this document.
    // Only the absolute same-document link keeps `s`.
    expect(targets.map((t) => t.id)).toEqual(['s']);
  });

  test('path and query are compared without decoding or slash folding', () => {
    const doc = page(
      `
      <h2 id="a">A</h2>
      <a href="https://example.com/a#a">slashless</a>
      <a href="https://example.com/a/#a">with slash</a>
      <a href="https://example.com/a%2Fb#a">encoded slash</a>
    `,
      'https://example.com/a',
    );
    const targets = collectFragmentIds(doc);
    // Only the exact origin+pathname+search match.
    expect(targets.map((t) => t.id)).toEqual(['a']);
  });

  test('percent-encoded fragments match a decoded id', () => {
    const doc = page(`
      <h2 id="café">Cafe</h2>
      <a href="#caf%C3%A9">link</a>
    `);
    const targets = collectFragmentIds(doc);
    expect(targets).toHaveLength(1);
    expect(targets[0]!.id).toBe('café');
    expect(targets[0]!.headingText).toBe('Cafe');
  });

  test('malformed percent-encoding does not throw', () => {
    const doc = page(`
      <h2 id="x%zz">Odd</h2>
      <a href="#x%zz">link</a>
    `);
    expect(() => collectFragmentIds(doc)).not.toThrow();
    const targets = collectFragmentIds(doc);
    // Kept raw when decodeURIComponent throws.
    expect(targets.map((t) => t.id)).toEqual(['x%zz']);
  });

  test('unlinked ids are not reported', () => {
    const doc = page(`
      <h1 id="used">Used</h1>
      <h2 id="orphan">Orphan</h2>
      <a href="#used">go</a>
    `);
    expect(collectFragmentIds(doc).map((t) => t.id)).toEqual(['used']);
  });

  test('root option limits both links and targets', () => {
    const doc = page(`
      <nav><a href="#outside">x</a></nav>
      <article id="root">
        <h2 id="inside">Inside</h2>
        <a href="#inside">y</a>
        <a href="#outside">z</a>
      </article>
      <h2 id="outside">Outside</h2>
    `);
    const root = doc.getElementById('root')!;
    const targets = collectFragmentIds(doc, { root });
    // Link to #outside is inside root, but the target element is not — dropped.
    // Link to #inside is kept.
    expect(targets.map((t) => t.id)).toEqual(['inside']);
  });

  test('search string is part of document identity', () => {
    const doc = page(
      `
      <h2 id="q">Q</h2>
      <a href="https://example.com/page?x=1#q">same query</a>
      <a href="https://example.com/page?x=2#q">other query</a>
      <a href="https://example.com/page#q">no query</a>
    `,
      'https://example.com/page?x=1',
    );
    expect(collectFragmentIds(doc).map((t) => t.id)).toEqual(['q']);
  });
});

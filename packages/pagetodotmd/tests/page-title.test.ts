import { describe, test, expect } from 'bun:test';
import { Window } from 'happy-dom';
import { decodeEntities, findPageTitle, normalizePageTitle } from '../src/page-title.js';

describe('decodeEntities', () => {
  test('decodes the standard named entities, case-sensitively', () => {
    expect(decodeEntities('Caf&eacute;')).toBe('Café');
    expect(decodeEntities('&Eacute;cole')).toBe('École');
    expect(decodeEntities('Sch&ouml;ne Gr&uuml;&szlig;e')).toBe('Schöne Grüße');
    expect(decodeEntities('&aacute;&ntilde;&ccedil;&oslash;')).toBe('áñçø');
    expect(decodeEntities('&laquo;Title&raquo; &mdash; 2026')).toBe('«Title» — 2026');
    expect(decodeEntities('&alpha;&beta; &micro;m &frac12; &euro;')).toBe('αβ \u00b5m ½ €');
    expect(decodeEntities('a&amp;b')).toBe('a&b');
  });

  test('decodes entities to their character, leaving whitespace folding to normalizePageTitle', () => {
    expect(decodeEntities('10&nbsp;лет')).toBe('10\u00a0лет');
    expect(decodeEntities('&#160;')).toBe('\u00a0');
  });

  test('decodes numeric and hex references', () => {
    expect(decodeEntities('&#x2014;')).toBe('—');
    expect(decodeEntities('&#8230;')).toBe('…');
    expect(decodeEntities('&#x1F600;')).toBe('😀');
  });

  test('remaps Windows-1252 numeric references the way HTML parsers do', () => {
    expect(decodeEntities('Don&#146;t')).toBe('Don’t');
    expect(decodeEntities('&#147;quoted&#148;')).toBe('“quoted”');
    expect(decodeEntities('a&#151;b')).toBe('a—b');
  });

  test('covers the whole WHATWG set, not a subset', () => {
    expect(decodeEntities('&colon;&comma;&excl;&period;&sol;&dollar;&equals;')).toBe(':,!./$=');
    expect(decodeEntities('&boxDL;&bigstar;&rarr;')).toBe('╗★→');
    expect(decodeEntities('&notin;')).toBe('∉');
    // 93 references map to two code points
    expect(decodeEntities('&NotEqualTilde;')).toBe('≂̸');
  });

  test('takes the longest reference, as the HTML tokenizer does', () => {
    expect(decodeEntities('&notit;')).toBe('¬it;');
    expect(decodeEntities('&copy2026')).toBe('©2026');
    expect(decodeEntities('&notin')).toBe('¬in');
  });

  test('leaves unmatched runs untouched', () => {
    expect(decodeEntities('AT&T')).toBe('AT&T');
    expect(decodeEntities('R&D budget')).toBe('R&D budget');
    expect(decodeEntities('Tom & Jerry')).toBe('Tom & Jerry');
    expect(decodeEntities('&zzz;')).toBe('&zzz;');
  });

  test('follows HTML on the missing semicolon: legacy names only', () => {
    expect(decodeEntities('10&nbsp самых')).toBe('10\u00a0 самых');
    expect(decodeEntities('Caf&eacute au lait')).toBe('Café au lait');
    // &hellip is not in HTML's semicolon-less list
    expect(decodeEntities('wait&hellip and see')).toBe('wait&hellip and see');
  });

  test('decodes one level only', () => {
    expect(decodeEntities('&amp;lt;')).toBe('&lt;');
    expect(decodeEntities('&amp;nbsp;')).toBe('&nbsp;');
    expect(decodeEntities('&amp;eacute;')).toBe('&eacute;');
  });

  test('keeps out-of-range and surrogate references as text', () => {
    expect(decodeEntities('&#0;')).toBe('&#0;');
    expect(decodeEntities('&#xD800;')).toBe('&#xD800;');
    expect(decodeEntities('&#1114112;')).toBe('&#1114112;');
  });
});

describe('normalizePageTitle', () => {
  // gazeta.ru: <meta name="twitter:title" content="10&amp;nbsp;самых…">
  test('resolves the double-encoded nbsp a site left in its metadata', () => {
    expect(normalizePageTitle('10&nbsp;самых красивых мужчин советского кинематографа'))
      .toBe('10 самых красивых мужчин советского кинематографа');
  });

  test('folds no-break spaces into plain ones', () => {
    expect(normalizePageTitle('10\u00a0самых')).toBe('10 самых');
    expect(normalizePageTitle('a\u202fb\ufeffc')).toBe('a b c');
  });

  test('collapses newlines, tabs and repeated spaces', () => {
    expect(normalizePageTitle('\n  Секс-символы СССР \n- Газета.Ru\n')).toBe('Секс-символы СССР - Газета.Ru');
    expect(normalizePageTitle('a b\tc')).toBe('a b c');
  });

  test('truncates to 200 code units with an ellipsis', () => {
    const long = normalizePageTitle('x'.repeat(250));
    expect(long.length).toBe(200);
    expect(long.endsWith('…')).toBe(true);
  });

  test('never leaves a lone surrogate at the cut', () => {
    const cut = normalizePageTitle('x'.repeat(198) + '😀' + 'y');
    expect(cut.length).toBeLessThanOrEqual(200);
    expect(cut).toBe('x'.repeat(198) + '…');
    expect([...cut].every(ch => {
      const cp = ch.codePointAt(0)!;
      return cp < 0xd800 || cp > 0xdfff;
    })).toBe(true);
  });

  test('keeps an emoji whole when it fits', () => {
    const cut = normalizePageTitle('x'.repeat(197) + '😀' + 'y'.repeat(10));
    expect(cut).toBe('x'.repeat(197) + '😀' + '…');
    expect(cut.length).toBe(200);
  });

  test('does not split a ZWJ sequence', () => {
    const family = '\u{1F468}\u200d\u{1F469}\u200d\u{1F467}'; // 8 code units
    const cut = normalizePageTitle('x'.repeat(195) + family + 'z'.repeat(10));
    expect(cut).toBe('x'.repeat(195) + '…');
    expect(cut.includes('\u200d')).toBe(false);
  });

  test('keeps a title that is exactly at the limit', () => {
    expect(normalizePageTitle('y'.repeat(200))).toBe('y'.repeat(200));
  });

  test('handles an empty title', () => {
    expect(normalizePageTitle('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// findPageTitle — which of the page's own claims about itself to believe
// ---------------------------------------------------------------------------

function page(head: string, title = ''): Document {
  const window = new Window({ url: 'https://example.com/article' });
  window.document.write(
    `<!DOCTYPE html><html><head><title>${title}</title>${head}</head><body><p>x</p></body></html>`,
  );
  return window.document as unknown as Document;
}

describe('findPageTitle', () => {
  test('the order of authority, one candidate removed at a time', () => {
    const og = '<meta property="og:title" content="Open Graph">';
    const tw = '<meta name="twitter:title" content="Twitter">';
    const ld = '<script type="application/ld+json">{"headline":"Schema"}</script>';
    const name = '<meta name="title" content="Name">';

    expect(findPageTitle(page(og + tw + ld + name, 'Tab'))).toBe('Open Graph');
    expect(findPageTitle(page(tw + ld + name, 'Tab'))).toBe('Twitter');
    expect(findPageTitle(page(ld + name, 'Tab'))).toBe('Schema');
    expect(findPageTitle(page(name, 'Tab'))).toBe('Name');
    expect(findPageTitle(page('', 'Tab'))).toBe('Tab');
  });

  test('a page that says nothing about itself yields an empty title', () => {
    expect(findPageTitle(page(''))).toBe('');
  });

  // A template that emitted its variable as nothing leaves the tag in place. An
  // empty candidate is not an answer — taken as one, the file is named after the
  // first site that ships `<meta property="og:title" content="">`.
  test('an empty or whitespace candidate is passed over, not accepted', () => {
    const doc = page(
      '<meta property="og:title" content="">' +
      '<meta name="twitter:title" content="   ">' +
      '<meta name="title" content="Third time lucky">',
      'Tab',
    );
    expect(findPageTitle(doc)).toBe('Third time lucky');
  });

  test('broken JSON-LD is stepped over, and a later block still answers', () => {
    // Half the JSON-LD in the wild is invalid; a trailing comma is not a reason
    // to fail a capture, and it must not stop the search either.
    const doc = page(
      '<script type="application/ld+json">{"headline": "unterminated</script>' +
      '<script type="application/ld+json">{"@type":"Article","headline":"The real one"}</script>',
      'Tab',
    );
    expect(findPageTitle(doc)).toBe('The real one');
  });

  test('JSON-LD with no headline at all falls through to the tab', () => {
    const doc = page(
      '<script type="application/ld+json">{"@type":"Organization","name":"SiteName"}</script>',
      'Tab',
    );
    expect(findPageTitle(doc)).toBe('Tab');
  });

  test('a headline that is not text is malformed metadata, not a title', () => {
    // schema.org's headline is Text; the wild also ships numbers and booleans.
    // String(0) would name the note "0" while the next candidate held the real
    // answer — a non-string steps to the next block like any other broken shape.
    const doc = page(
      '<script type="application/ld+json">{"headline": 0}</script>' +
      '<script type="application/ld+json">{"@type":"Article","headline":"The text one"}</script>',
      'Tab',
    );
    expect(findPageTitle(doc)).toBe('The text one');
  });

  test('a whitespace-only headline does not end the walk', () => {
    // Returning "  ".trim() used to stop the scan with nothing: the || chain
    // moved on to the meta tags, but a real headline in the next block was
    // never read.
    const doc = page(
      '<script type="application/ld+json">{"headline": "   "}</script>' +
      '<script type="application/ld+json">{"headline": "Second block"}</script>',
      'Tab',
    );
    expect(findPageTitle(doc)).toBe('Second block');
  });

  // The defect the whole file exists for: the HTML parser decodes an attribute
  // once, so a doubly encoded template hands back a literal `&nbsp;` that would
  // reach the front matter and the download's file name.
  test('the candidate is normalised, entities and no-break spaces and all', () => {
    const doc = page(
      '<meta property="og:title" content="10&amp;nbsp;самых &amp;laquo;тихих&amp;raquo;">',
    );
    expect(findPageTitle(doc)).toBe('10 самых «тихих»');
  });

  test('a title written across lines arrives as one line', () => {
    const doc = page('<meta property="og:title" content="A title\n  split over lines">');
    expect(findPageTitle(doc)).toBe('A title split over lines');
  });

  test('the document is the argument — a second one is answered on its own', () => {
    const a = page('<meta property="og:title" content="First">');
    const b = page('<meta property="og:title" content="Second">');
    expect(findPageTitle(a)).toBe('First');
    expect(findPageTitle(b)).toBe('Second');
  });
});

// Page titles come from site metadata, and that metadata is not always clean.
// gazeta.ru ships <meta name="twitter:title" content="10&amp;nbsp;самых…">:
// the HTML parser decodes the attribute once, so getAttribute() hands us a
// literal "&nbsp;" that would end up in the YAML front matter and in the
// download file name. Decode one more level and normalise the whitespace.

import { ENTITY_KEYS, MAX_ENTITY_KEY_LEN } from './html-entities';
import { truncateGraphemes } from './truncate.js';

// Numeric references in the C1 range are what a Windows-1252 authoring tool
// meant, not the control characters they name; HTML parsers remap them and so
// do we — "&#146;" is a right single quote, not U+0092.
const C1_REMAP: Record<number, number> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020,
  0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152,
  0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022,
  0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a,
  0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178,
};

// Decoding follows the HTML tokenizer: the longest reference the table knows
// wins, which is why "&notit;" is "¬it;" and "&copy2026" is "©2026", and why
// html-entities.ts ships the whole set. One pass only, so "&amp;lt;" stays
// "&lt;" rather than collapsing into "<"; unmatched runs ("AT&T", "R&D") are
// left exactly as they were written.
export function decodeEntities(text: string): string {
  return text.replace(
    /&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*)(;?)/g,
    (match, body: string, semicolon: string) => {
      if (body[0] === '#') {
        const raw = body[1] === 'x' || body[1] === 'X'
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
        const code = C1_REMAP[raw] ?? raw;
        // Surrogates and out-of-range values would throw; keep the source text.
        if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
        if (code >= 0xd800 && code <= 0xdfff) return match;
        return String.fromCodePoint(code);
      }
      // The semicolon is part of the reference, so match against the run with
      // it attached and hand back whatever the shorter match did not consume.
      const run = body + semicolon;
      for (let len = Math.min(run.length, MAX_ENTITY_KEY_LEN); len >= 2; len--) {
        const chars = ENTITY_KEYS.get(run.slice(0, len));
        if (chars !== undefined) return chars + run.slice(len);
      }
      return match;
    },
  );
}

const TITLE_MAX = 200;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return truncateGraphemes(text, max - 1) + '…'; // the ellipsis takes one code unit
}

export function normalizePageTitle(raw: string): string {
  const clean = decodeEntities(raw)
    .replace(/[\n\r\t\u2028\u2029]+/g, ' ')
    // No-break variants read as spaces but break file names and search.
    .replace(/[\u00a0\u2007\u202f\ufeff]/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
  return truncate(clean, TITLE_MAX);
}

/**
 * What this page calls itself, from the first of its own metadata that answers.
 *
 * `document.title` is the obvious answer and the worst one: it is written for a
 * browser tab, so it carries the site name, a separator, an unread count, and on
 * a news site the section as well \u2014 `Article \u2014 Section | SiteName`. All of that
 * reaches the front matter and the download's file name, where a reader has to
 * live with it. What a page states *about itself* is better in every case where
 * it exists, so the ordinary sharing metadata is asked first and the tab is the
 * fallback rather than the source.
 *
 * The order is the order of authority. `og:title` is what the page publishes as
 * its own name and is the one most sites keep correct, because a wrong one is
 * visible in every share. `twitter:title` is the same claim from a site that
 * filled in only one of the two. `headline` from schema.org is the article's
 * own, and it sits below the two because it is often the *long* form or a desk
 * headline, while the Open Graph value is what the publisher chose to show.
 * `meta[name=title]` is rare and old, worth a look before falling back. First
 * non-empty wins; a candidate that is present but blank is passed over rather
 * than accepted, which is what a site emitting `<meta property="og:title"
 * content="">` needs.
 *
 * Every candidate goes through `normalizePageTitle`, and that is not tidiness:
 * metadata is written by templates rather than typed, so it arrives with a
 * doubly encoded entity, a newline from a here-document, or a no-break space
 * that a file name cannot hold.
 *
 * The document is a parameter, like everything else in this package \u2014 a capture
 * may be reading a frame, and nothing here may reach for a global.
 *
 * Declared limit: a `ld+json` block whose top level is an array, or a
 * `@graph`, is not walked. Only the first block whose `headline` carries
 * non-blank text is read — the value itself may be that text or a JSON-LD
 * array holding it. Anything malformed — a `headline` that is a number or a
 * boolean, alone or inside the array — is stepped over rather than thrown,
 * because a page's broken metadata is not a reason to fail a capture.
 */
export function findPageTitle(doc: Document): string {
  const meta = (attribute: string, value: string): string =>
    doc.querySelector(`meta[${attribute}="${value}"]`)?.getAttribute('content')?.trim() ?? '';

  const raw =
    meta('property', 'og:title') ||
    meta('name', 'twitter:title') ||
    // Asked only when the two above said nothing: parsing every JSON-LD block on
    // a page that already named itself is work with no answer to give.
    schemaHeadline(doc) ||
    meta('name', 'title') ||
    doc.title ||
    '';
  return normalizePageTitle(raw);
}

/** `headline` from the first JSON-LD block that carries one as non-blank text. */
function schemaHeadline(doc: Document): string {
  for (const el of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    let data: unknown;
    try {
      data = JSON.parse(el.textContent ?? '');
    } catch {
      // Half the JSON-LD in the wild is invalid \u2014 a trailing comma, a template
      // that emitted an unquoted value. Step over the block, not the page.
      continue;
    }
    if (typeof data !== 'object' || data === null) continue;
    const headline = (data as { headline?: unknown }).headline;
    // Text or nothing. schema.org's headline is Text, but the wild also ships
    // `{"headline": 0}` \u2014 and `String(0)` would make "0" the note's title and
    // its file name while the next candidate held the real one. JSON-LD also
    // permits an array of values, and `["Title"]` is an ordinary spelling of
    // one title \u2014 so an array is walked for its first non-blank string, and a
    // non-string (inside the array or standing alone) is stepped over like
    // every other malformed shape here. So is text that is blank once trimmed,
    // which used to end the walk early with nothing to show for it.
    for (const candidate of Array.isArray(headline) ? headline : [headline]) {
      if (typeof candidate !== 'string') continue;
      const text = candidate.trim();
      if (text !== '') return text;
    }
  }
  return '';
}

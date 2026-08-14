/**
 * The text work a capture needs and a DOM cannot do: entity decoding, grapheme
 * truncation, and the page title those two make safe.
 *
 * A subpath of its own because nothing here touches a node. A side panel showing
 * a filename, a service worker naming a download, a page that never had a
 * selection — each needs `truncateGraphemes` and none of them should pull in a
 * style snapshot to get it. The main entry is a browser package; this is not.
 *
 * `page-title.ts` is split across the two on that line and not by subject:
 * `findPageTitle` reads a document's own metadata, so it is on the main entry
 * with everything else that needs one, and `normalizePageTitle` — the pass that
 * makes any of those candidates fit to be a file name — is here.
 */
export { decodeEntities, normalizePageTitle } from './page-title.js';
export { truncateGraphemes } from './truncate.js';
export { ENTITY_KEYS, MAX_ENTITY_KEY_LEN } from './html-entities.js';

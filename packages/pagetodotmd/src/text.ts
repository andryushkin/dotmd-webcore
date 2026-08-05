/**
 * The text work a capture needs and a DOM cannot do: entity decoding, grapheme
 * truncation, and the page title those two make safe.
 *
 * A subpath of its own because nothing here touches a node. A side panel showing
 * a filename, a service worker naming a download, a page that never had a
 * selection — each needs `truncateGraphemes` and none of them should pull in a
 * style snapshot to get it. The main entry is a browser package; this is not.
 */
export { decodeEntities, normalizePageTitle } from './page-title.js';
export { truncateGraphemes } from './truncate.js';
export { ENTITY_KEYS, MAX_ENTITY_KEY_LEN } from './html-entities.js';

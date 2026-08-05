/**
 * What a `Range` needs before it can be converted, and what several fragments
 * need before they can be converted as one document.
 *
 * A subpath of its own for the reason the others have one: it is the piece of
 * this library a *capture* needs and a caller converting a string never touches.
 * It also answers a question the main entry could not: `.` resolves to a
 * different build per environment, and the server build has no range surface at
 * all — `enrichRange` lives only in `browser.ts`. A consumer importing it by
 * name from `htmltodotmd` therefore got it in Chrome and `undefined` under Bun,
 * which is the shape of failure a subpath exists to prevent.
 *
 * Everything here is a re-export. The implementations stay where their
 * neighbours are; what this file adds is the promise that these five names are
 * reachable from outside the package and will not move without notice.
 */
export {
  enrichRange,
  DEFAULT_PAGE_MARKS,
  headingOffsetAcross,
  topHeadingLevelAcross,
  offsetForTop,
  selectionToMarkdown,
} from './browser.js';
export type { PageMarks } from './browser.js';

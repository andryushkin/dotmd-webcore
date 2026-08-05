/**
 * How this dialect is parsed, in one place.
 *
 * `breaks` because a capture's line breaks are the page's line breaks and a
 * reader who saw two lines must not be shown one; `gfm` for the tables, task
 * lists and strikethrough the converter writes; `html` because the maths
 * placeholders and a product's own contributed blocks travel as markup through
 * the parser, and because a note may hold HTML its author typed.
 *
 * Its own module, small as it is, so that the plain-text subpath can hold the
 * profile without pulling a maths hydrator it never calls in behind it.
 *
 * Exported because a third reader of this dialect exists outside this package —
 * the clipper's fidelity oracle asks what a reader would see, and it must ask it
 * of the same parser. Two spellings of a profile drift silently: the oracle would
 * go on measuring a renderer nobody runs.
 */
import type { MarkedOptions } from './engines.js';

export const MARKED_PROFILE: MarkedOptions = { breaks: true, gfm: true, html: true };

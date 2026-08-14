/**
 * Whether a reader was shown an element, asked of a live layout engine.
 *
 * The scorer in `extract.ts` counts characters, and every character it counts is
 * a claim that somebody could read it. The question is "is this rendered", not
 * "is `display: none` set on it", and the two are not the same question: inside
 * a subtree hidden at the top — a collapsed menu, an inactive tab panel, the
 * settings sheet a second extension injects into every page — every descendant
 * still computes its own `display: block`. Reading one element's style answers
 * the wrong question, and a settings panel measured on a live page held 2707
 * characters under a wrapper that was `display: none`: the reader opened a
 * document made of font names on a page whose real prose was 33 characters long.
 *
 * This is the one file here that reads a cascade outside `style-snapshot.ts`, and
 * for the opposite reason: the snapshot records what the converter will need
 * *later*, and this answers a question the scorer is asking *now*. Neither writes
 * anything while it walks. The view is taken from the element's own document
 * rather than from a global, the same rule the rest of the package keeps — a
 * caller in a service worker, a test under linkedom, and a second frame all have
 * to be able to ask.
 *
 * Under a harness with no useful cascade this answers `true` for everything,
 * which is exactly what `findArticle` used to be given as its default. That is
 * not a shortcut: linkedom lays nothing out, so any answer it produced would be a
 * certainty the harness cannot give. Chrome is the last word.
 */

/** The part of a window this file needs; a `Window` satisfies it structurally. */
interface StyleView {
  getComputedStyle(el: Element): VisibilityStyle | null | undefined;
}

/** The two properties the walk reads. `CSSStyleDeclaration` satisfies it. */
interface VisibilityStyle {
  readonly display: string;
  readonly visibility: string;
}

/** `checkVisibility` as the browser has it; absent under linkedom and older engines. */
type ElementWithCheckVisibility = Element & {
  checkVisibility?: (options?: Record<string, boolean>) => boolean;
};

/**
 * Visibility from a real layout engine, when one is present.
 *
 * `checkVisibility()` is the browser answering for the whole ancestor chain in
 * one call, which is what keeps this cheap enough to be a predicate the scorer
 * runs on every element of a page. Only `visibilityProperty` is turned on with
 * it: `opacityProperty` would drop an article that fades in on scroll, and
 * `contentVisibilityAuto` would drop the offscreen half of a long page that
 * renders itself lazily — both are text a reader wants and both would be scored
 * as nothing.
 *
 * The two answers below `checkVisibility()` are the ones it gets *right* about
 * boxes and wrong about text; see `renderedWithoutABoxOfItsOwn`. An engine
 * without the method at all falls back on the ancestor walk, and an engine that
 * refuses the options bag tells us nothing, so it falls back too rather than
 * dropping the page.
 *
 * `content-visibility: hidden` is deliberately not asked here even though the
 * snapshot stops at it: this predicate answers what a *reader* was shown, and
 * `contentVisibilityAuto` is the option that would have made a lazily rendered
 * page disappear. The two verdicts live on either side of the same page for
 * different consumers, which is why neither is written in terms of the other.
 */
export function isElementVisible(el: Element): boolean {
  const view = el.ownerDocument?.defaultView as StyleView | null | undefined;
  if (!view || typeof view.getComputedStyle !== 'function') return true;

  const check = (el as ElementWithCheckVisibility).checkVisibility;
  if (typeof check === 'function') {
    let rendered: boolean;
    try {
      rendered = check.call(el, { visibilityProperty: true }) !== false;
    } catch {
      // An implementation that refuses the options bag tells us nothing; fall
      // back rather than drop the page.
      return ancestorsRender(view, el);
    }
    if (rendered) return true;
    return renderedWithoutABoxOfItsOwn(view, el);
  }

  return ancestorsRender(view, el);
}

/**
 * The two ways Chrome answers "not rendered" about text a reader can still get
 * to. Reached only after `checkVisibility()` has already said no, so the extra
 * style reads never touch the common path.
 *
 * - **`display: contents`** — the wrapper has no box of its own while every
 *   paragraph inside it is on screen. Grid and flex layouts wrap real article
 *   prose in exactly this, and calling the wrapper hidden drops the subtree with
 *   it, because the scorer never descends past an element it called invisible.
 * - **A folded `<details>`** — Chrome reports the folded content as not
 *   rendered, and it is; but a reading mode opens every `<details>` on its clone
 *   (`openDetails` in `clone-edits.ts`), so that text ships in the Markdown
 *   either way. Scoring it as zero would let an FAQ or a docs page written as a
 *   stack of closed disclosures be refused as too thin, and the answer to "is
 *   this the article" must match what the article will contain. A consumer whose
 *   policy is the other one — the clipper keeps a collapsed `<details>` to its
 *   `<summary>` alone — is a consumer that should hand `findArticle` a predicate
 *   of its own rather than take this default.
 *
 * Both delegate upward instead of returning `true` outright: a `display: contents`
 * wrapper or a folded `<details>` inside a hidden panel is still hidden.
 */
function renderedWithoutABoxOfItsOwn(view: StyleView, el: Element): boolean {
  const parent = el.parentElement;
  if (!parent) return false;

  if (computedDisplay(view, el) === 'contents') return isElementVisible(parent);

  // From the parent, so a `<details>` nested in another folded one asks about
  // the outer disclosure rather than matching itself.
  const folded =
    typeof parent.closest === 'function' ? parent.closest('details:not([open])') : null;
  if (folded) {
    // Only what the fold alone hides: something inside it that is also
    // `display: none` on its own account stays hidden.
    return ancestorsRender(view, el, folded) && isElementVisible(folded);
  }

  return false;
}

/**
 * The same question without `checkVisibility()`: walk the ancestors for
 * `display: none`.
 *
 * `visibility` is inherited, so one read of the element's own style already
 * answers for the whole chain; `display` is not, and a descendant of a hidden
 * wrapper reports its own value. A harness that stops answering mid-walk gets
 * the benefit of the doubt — a missing style is not evidence of hiding.
 *
 * `stopAt` bounds the walk to a subtree whose root has already been asked about.
 */
function ancestorsRender(
  view: StyleView,
  el: Element,
  stopAt: Element | null = null,
): boolean {
  const own = computedStyleOf(view, el);
  if (!own) return true;
  // `collapse` is `hidden` everywhere outside a table row or column.
  if (own.visibility === 'hidden' || own.visibility === 'collapse') return false;
  if (own.display === 'none') return false;
  for (let node = el.parentElement; node && node !== stopAt; node = node.parentElement) {
    const style = computedStyleOf(view, node);
    if (!style) return true;
    if (style.display === 'none') return false;
  }
  // opacity:0 and zero-size boxes still contribute to some pages' "visible"
  // chrome; length scoring only needs "rendered at all".
  return true;
}

function computedDisplay(view: StyleView, el: Element): string {
  return computedStyleOf(view, el)?.display ?? '';
}

function computedStyleOf(view: StyleView, el: Element): VisibilityStyle | null {
  try {
    return view.getComputedStyle(el) ?? null;
  } catch {
    // A detached node or a harness that throws on unknown tags is not a reason
    // to drop the whole article from scoring.
    return null;
  }
}

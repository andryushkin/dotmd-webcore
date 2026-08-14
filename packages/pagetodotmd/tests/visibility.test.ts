/**
 * What a reader was shown — the predicate the scorer spends on every element.
 *
 * What bun can prove here: the ancestor chain is answered rather than one
 * element's own style, a harness with no cascade is given the benefit of the
 * doubt, and the two cases Chrome calls "not rendered" about text a reader can
 * still reach are treated as visible.
 *
 * What it cannot prove: happy-dom answers `checkVisibility()` for a
 * `display: none` ancestor, which is enough to hold the predicate to its job,
 * but it does not model a box that exists and draws nothing — `display: contents`
 * and a folded `<details>`. Those two are asserted against a stubbed browser
 * answer here and measured in Chrome.
 */
import { describe, test, expect } from 'bun:test';
import { Window } from 'happy-dom';
import { parseHTML } from 'linkedom';
import { isElementVisible } from '../src/visibility.js';
import { findArticle } from '../src/extract.js';

function page(html: string, url = 'https://example.com/article'): Document {
  const window = new Window({ url });
  window.document.write(html);
  return window.document as unknown as Document;
}

const ORDINARY_ARTICLE = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>An article</title></head>
<body>
  <article>
    <h1>A heading over some prose</h1>
    <p>A paragraph long enough that nothing about it is remarkable.</p>
  </article>
</body></html>`;

// The page the predicate exists for. The panel is a second extension's settings
// sheet: hidden at the top, every descendant computing its own `display: block`,
// and holding twenty times the prose the page itself has.
const HIDDEN_PANEL_PAGE = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Thin page with an injected panel</title>
<style>#ext-panel { display: none; }</style></head>
<body>
  <div id="post">
    <h1>A short note</h1>
    <p>One real paragraph, shorter than the floor.</p>
  </div>
  <div id="ext-panel">
    <div id="ext-body">
      <h2>Appearance</h2>
      <p>Arial. Arial Black. Athelas. Comic Sans MS. Courier New. Courier. Didot.
      Georgia. Gill Sans. Helvetica. Impact. Iowan Old Style. Palatino. Optima.
      Times New Roman. Trebuchet MS. OpenDyslexic. LexendDeca. Lexend Exa.</p>
      <p>Line height. Letter spacing. Word spacing. Paragraph spacing. Column
      width. Text alignment. Justification. Hyphenation. Reading ruler. Focus
      mode. Colour overlays. Contrast. Invert. Sepia. Night. Read aloud.</p>
      <p>Keyboard shortcuts, per-site rules, export, sync, licence, changelog,
      privacy, support, feedback, about, version, updates, profiles, presets,
      defaults, reset, import, backup, restore.</p>
    </div>
  </div>
</body>
</html>`;

describe('isElementVisible', () => {
  test('returns a boolean without throwing on a normal element', () => {
    const doc = page(ORDINARY_ARTICLE);
    const el = doc.querySelector('article')!;
    expect(typeof isElementVisible(el)).toBe('boolean');
  });

  test('an element the page renders is visible', () => {
    const doc = page(HIDDEN_PANEL_PAGE);
    expect(isElementVisible(doc.querySelector('#post')!)).toBe(true);
    expect(isElementVisible(doc.querySelector('#post p')!)).toBe(true);
  });

  test('a descendant of a display:none ancestor is not visible', () => {
    // The defect: the descendant's own computed display is `block`, so a
    // predicate that reads one element's style calls a hidden settings panel
    // visible and its font list becomes the article.
    const doc = page(HIDDEN_PANEL_PAGE);
    expect(isElementVisible(doc.querySelector('#ext-panel')!)).toBe(false);
    expect(isElementVisible(doc.querySelector('#ext-body')!)).toBe(false);
    expect(isElementVisible(doc.querySelector('#ext-body p')!)).toBe(false);
  });

  test('visibility:hidden is still hidden, on both paths', () => {
    const doc = page(`<!DOCTYPE html><html><body>
      <p id="v" style="visibility: hidden">gone</p>
    </body></html>`);
    const el = doc.querySelector('#v')!;
    expect(isElementVisible(el)).toBe(false);
    // Same answer without checkVisibility(), i.e. on a harness that has a
    // cascade but not the browser method.
    withoutCheckVisibility(el, () => {
      expect(isElementVisible(el)).toBe(false);
    });
  });

  test('without checkVisibility() the ancestor walk gives the same answers', () => {
    const doc = page(HIDDEN_PANEL_PAGE);
    const inner = doc.querySelector('#ext-body p')!;
    const real = doc.querySelector('#post p')!;
    withoutCheckVisibility(inner, () => {
      expect(isElementVisible(inner)).toBe(false);
    });
    withoutCheckVisibility(real, () => {
      expect(isElementVisible(real)).toBe(true);
    });
  });

  test('display:contents is visible even when the browser says it draws nothing', () => {
    // Chrome answers `checkVisibility() === false` for an element with no box
    // of its own, and a `display: contents` wrapper has none while its children
    // are on screen. happy-dom answers `true` here, so the browser's answer is
    // stubbed rather than assumed.
    const doc = page(`<!DOCTYPE html><html><body>
      <div id="wrap" style="display: contents"><p>Prose that is on screen.</p></div>
    </body></html>`);
    const wrap = doc.querySelector('#wrap')!;
    stubCheckVisibility(wrap, () => false, () => {
      expect(isElementVisible(wrap)).toBe(true);
    });
  });

  test('folded <details> content counts, because a reading mode opens it on the clone', () => {
    // Measured in Chrome: content of a closed <details> answers
    // `checkVisibility() === false`. `openDetails` opens every disclosure on the
    // clone, so that text is in the Markdown regardless — scoring it as zero
    // would refuse an FAQ written as a stack of closed disclosures as "too thin".
    const doc = page(`<!DOCTYPE html><html><body>
      <details id="d"><summary>Question</summary><p id="answer">The answer text.</p></details>
      <div id="panel" style="display: none">
        <details id="hd"><summary>Q</summary><p id="hidden-answer">Panel answer.</p></details>
      </div>
    </body></html>`);
    const answer = doc.querySelector('#answer')!;
    stubCheckVisibility(answer, () => false, () => {
      expect(isElementVisible(answer)).toBe(true);
    });
    // The same fold inside a hidden panel stays hidden — the fold delegates
    // upward instead of answering "visible" on its own.
    const hidden = doc.querySelector('#hidden-answer')!;
    stubCheckVisibility(hidden, () => false, () => {
      expect(isElementVisible(hidden)).toBe(false);
    });
  });

  test('a display:none node inside a folded <details> is still hidden', () => {
    const doc = page(`<!DOCTYPE html><html><body>
      <details id="d"><summary>Question</summary>
        <div id="menu" style="display: none"><p id="menu-p">Collapsed menu.</p></div>
      </details>
    </body></html>`);
    const menuP = doc.querySelector('#menu-p')!;
    stubCheckVisibility(menuP, () => false, () => {
      expect(isElementVisible(menuP)).toBe(false);
    });
  });

  test('under a harness with no cascade at all every element is visible', () => {
    const { document: doc } = parseHTML(
      `<html><body><div style="display:none"><p id="p">text</p></div></body></html>`,
    );
    const el = (doc as unknown as Document).querySelector('#p')!;
    expect(isElementVisible(el)).toBe(true);
  });
});

describe('findArticle takes this as its default', () => {
  // The pair, stated as the difference it makes. Nothing on this page is a
  // semantic candidate, so both divs are scored as block containers, and the
  // hidden one holds twenty times the prose. The old default — "everything is
  // visible" — handed the reader a document made of font names; the honest
  // answer is that the page is too thin to read.
  test('a hidden panel does not become the article', () => {
    const doc = page(HIDDEN_PANEL_PAGE);
    const lying = findArticle(doc, { isVisible: () => true });
    expect(lying.ok).toBe(true);
    if (lying.ok) {
      expect(lying.nodes.some((n) => n.id === 'ext-panel' || n.id === 'ext-body')).toBe(true);
    }

    const honest = findArticle(doc);
    expect(honest.ok).toBe(false);
    if (!honest.ok) expect(honest.reason).toBe('too-thin');
  });
});

/** Run `body` with `checkVisibility` absent from one element. */
function withoutCheckVisibility(el: Element, body: () => void): void {
  const own = el as unknown as { checkVisibility?: unknown };
  Object.defineProperty(own, 'checkVisibility', {
    value: undefined,
    configurable: true,
  });
  try {
    body();
  } finally {
    delete own.checkVisibility;
  }
}

/** Run `body` with one element answering `checkVisibility` the way Chrome would. */
function stubCheckVisibility(el: Element, answer: () => boolean, body: () => void): void {
  const own = el as unknown as { checkVisibility?: unknown };
  Object.defineProperty(own, 'checkVisibility', { value: answer, configurable: true });
  try {
    body();
  } finally {
    delete own.checkVisibility;
  }
}

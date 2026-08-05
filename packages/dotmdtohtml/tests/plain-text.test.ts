import { describe, test, expect, beforeEach } from 'bun:test';
import { Window } from 'happy-dom';
import { Marked } from 'marked';
import { createPlainTextRenderer, type PlainTextOptions } from '../src/plain-text.js';

let toPlainText: (md: string) => string;

beforeEach(() => {
  const win = new Window();
  toPlainText = createPlainTextRenderer({
    Marked: Marked as unknown as PlainTextOptions['Marked'],
    sanitize: (html) => html,
    document: win.document as unknown as Document,
  });
});

describe('the marks come off', () => {
  test('emphasis and headings leave their text', () => {
    expect(toPlainText('# Title\n\nA **bold** and *italic* line.')).toBe(
      'Title\n\nA bold and italic line.',
    );
  });

  test('a link leaves its label, not its target', () => {
    expect(toPlainText('See [the page](https://e.com/x).')).toBe('See the page.');
  });

  // The dialect's own marker. Without the extension the text came out holding
  // four `=` — the file's syntax showing through the one output whose whole job
  // is to have none. In the panel this worked by accident: a shared `marked` had
  // been configured by whoever rendered the preview first.
  test('a highlight leaves its phrase', () => {
    expect(toPlainText('A ==marked== phrase')).toBe('A marked phrase');
  });

  test('a list is one item per line', () => {
    expect(toPlainText('- a\n- b')).toBe('a\n\nb');
  });

  // The rows, not the cells: whether two cells of one row run together or arrive
  // on two lines is the parser's whitespace handling and differs between a real
  // browser and the one this test runs in. What must hold either way is that the
  // second row does not begin on the first row's line.
  test('a table keeps its rows apart', () => {
    expect(toPlainText('| a | b |\n| - | - |\n| c | d |')).toMatch(/a\s*b\n+c\s*d/);
  });

  // `breaks` is in the profile because a capture's line breaks are the page's.
  test('a line break in the note is a line break in the text', () => {
    expect(toPlainText('a\nb')).toBe('a\nb');
  });

  test('an entity arrives as its character', () => {
    expect(toPlainText('a &amp; b')).toBe('a & b');
  });
});

describe('what it does not do', () => {
  // No hydration, no placeholders: the file holds LaTeX and LaTeX is the closest
  // thing a formula has to plain text.
  test('a formula stays as the reader wrote it', () => {
    expect(toPlainText('Energy $E=mc^2$ here')).toBe('Energy $E=mc^2$ here');
  });

  test('a fenced listing keeps its dollars and its blank lines', () => {
    expect(toPlainText('```sh\necho $PATH$HOME\n```')).toBe('echo $PATH$HOME');
  });

  // Everything on its way through an element is sanitized, even though nothing
  // is mounted: a note may hold markup its author typed.
  test('the markup goes through the sanitizer', () => {
    let seen = '';
    const win = new Window();
    const strip = createPlainTextRenderer({
      Marked: Marked as unknown as PlainTextOptions['Marked'],
      sanitize: (html) => {
        seen = html;
        return '<p>replaced</p>';
      },
      document: win.document as unknown as Document,
    });
    expect(strip('# x')).toBe('replaced');
    expect(seen).toContain('<h1>x</h1>');
  });
});

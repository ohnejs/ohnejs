import { deepStrictEqual, ok } from 'node:assert';
import { describe, it } from 'node:test';

import type { RichText } from '../../../src/utils/index.ts';

import { checkRichText, richTextToText, textToRichText } from '../../../src/utils/index.ts';

function paragraphs(...texts: string[]): RichText {
  return texts.map((text) => ({ kind: 'paragraph', content: [{ text }] }));
}

describe('textToRichText', () => {
  it('splits paragraphs at a blank line and keeps a single `\\n` as a line break', () => {
    deepStrictEqual(textToRichText('a\nb\n\nc'), paragraphs('a\nb', 'c'));
    deepStrictEqual(textToRichText('a\n \t\n\n\nb'), paragraphs('a', 'b'));
  });

  it('turns `\\r\\n` and `\\r` into `\\n`', () => {
    deepStrictEqual(textToRichText('a\r\nb\r\n\r\nc\rd'), paragraphs('a\nb', 'c\nd'));
  });

  it('drops blank lines around the text and keeps the spaces inside it', () => {
    deepStrictEqual(textToRichText('\n\n a \n\n'), paragraphs(' a '));
    deepStrictEqual(textToRichText('  a  '), paragraphs('  a  '));
  });

  it('trims long whitespace runs in linear time', () => {
    const run = 200_000;
    const start = performance.now();
    deepStrictEqual(textToRichText(`x${'\n'.repeat(run)}y`), paragraphs('x', 'y'));
    deepStrictEqual(textToRichText(`${' \n'.repeat(run)}x${'\n '.repeat(run)}`), paragraphs('x'));
    ok(performance.now() - start < 1000);
  });

  it('gives `[]` for empty text', () => {
    deepStrictEqual(textToRichText(''), []);
    deepStrictEqual(textToRichText('\n\n'), []);
  });

  it('never parses markdown', () => {
    deepStrictEqual(textToRichText('# a\n\n- b **c**'), paragraphs('# a', '- b **c**'));
  });

  it('reads the text `richTextToText` writes back as the same paragraphs', () => {
    const value = paragraphs('a\nb', 'c');
    deepStrictEqual(textToRichText(richTextToText(value)), value);
    deepStrictEqual(checkRichText(value, { elements: [] }), []);
  });
});

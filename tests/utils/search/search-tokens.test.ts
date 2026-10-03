import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { searchTokens } from '../../../src/utils/index.ts';

describe('searchTokens', () => {
  it('splits on any whitespace', () => {
    deepStrictEqual(searchTokens(' foo\tbar\n baz\u3000qux '), ['foo', 'bar', 'baz', 'qux']);
  });

  it('answers no tokens for blank text', () => {
    deepStrictEqual(searchTokens(''), []);
    deepStrictEqual(searchTokens('  \t '), []);
  });

  it('NFC-normalizes the query', () => {
    deepStrictEqual(searchTokens('Cafe\u0301'), ['Caf\u00e9']);
  });

  it('keeps a trailing combining mark of an NFD token that has no NFC form', () => {
    deepStrictEqual(searchTokens('q\u0307'), ['q\u0307']);
  });

  it('reads a double-quoted run as one token with inner whitespace collapsed', () => {
    deepStrictEqual(searchTokens('see "  new \t york " now'), ['see', 'new york', 'now']);
  });

  it('reads each quoted pair as its own phrase', () => {
    deepStrictEqual(searchTokens('"ab cd" ef "gh ij"'), ['ab cd', 'ef', 'gh ij']);
  });

  it('treats an unmatched quote as a plain character', () => {
    deepStrictEqual(searchTokens('"ab cd" o"neil'), ['ab cd', 'o"neil']);
    deepStrictEqual(searchTokens('ab "cd ef'), ['ab', 'cd', 'ef']);
  });

  it('drops an empty phrase', () => {
    deepStrictEqual(searchTokens('ab "" "  " cd'), ['ab', 'cd']);
  });

  it('strips leading and trailing punctuation and symbols', () => {
    deepStrictEqual(searchTokens('(foo), «bar»! $baz€ ...'), ['foo', 'bar', 'baz']);
  });

  it('keeps inner punctuation', () => {
    deepStrictEqual(searchTokens('sea.jpg a@b.c q-3'), ['sea.jpg', 'a@b.c', 'q-3']);
  });

  it('strips the edges of a phrase', () => {
    deepStrictEqual(searchTokens('"(new york)"'), ['new york']);
  });

  it('drops a one-character ASCII token', () => {
    deepStrictEqual(searchTokens('a big 7 "x" b.'), ['big']);
  });

  it('keeps a lone non-ASCII character', () => {
    deepStrictEqual(searchTokens('東 é'), ['東', 'é']);
  });

  it('keeps a lone astral character', () => {
    deepStrictEqual(searchTokens('𠀋'), ['𠀋']);
  });

  it('opens a phrase only at a word start and closes it only at a word end', () => {
    deepStrictEqual(searchTokens('o"neil "new york"'), ['o"neil', 'new york']);
    deepStrictEqual(searchTokens('12" "flat screen"'), ['12', 'flat screen']);
  });

  it('trims a phrase again once its edge punctuation is gone', () => {
    deepStrictEqual(searchTokens('"a ." "new york ." " . foo"'), ['new york', 'foo']);
  });

  it('drops a token over 256 UTF-8 bytes', () => {
    deepStrictEqual(searchTokens(`${'a'.repeat(256)} ${'a'.repeat(257)} ok`), [
      'a'.repeat(256),
      'ok',
    ]);
    deepStrictEqual(searchTokens(`${'é'.repeat(128)} ${'é'.repeat(129)}`), ['é'.repeat(128)]);
  });

  it('dedupes case-insensitively, keeping the first', () => {
    deepStrictEqual(searchTokens('Foo bar FOO foo. Bar'), ['Foo', 'bar']);
  });

  it('dedupes ignoring accents', () => {
    deepStrictEqual(searchTokens('Café cafe CAFÉ'), ['Café']);
  });

  it('keeps the first ten tokens', () => {
    const words = Array.from({ length: 12 }, (_, at) => `w${at}`);
    deepStrictEqual(searchTokens(words.join(' ')), words.slice(0, 10));
  });

  it('counts the cap after dropping and deduping', () => {
    const words = Array.from({ length: 10 }, (_, at) => `w${at}`);
    deepStrictEqual(searchTokens(`a w0 W0 - ${words.join(' ')}`), words);
  });
});

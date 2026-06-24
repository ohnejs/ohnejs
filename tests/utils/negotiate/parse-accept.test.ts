import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { parseAccept } from '../../../src/utils/negotiate/parse-accept.ts';

describe('parseAccept', () => {
  it('defaults a missing quality to 1', () => {
    deepStrictEqual(parseAccept('en'), [{ value: 'en', q: 1 }]);
  });

  it('reads the q parameter and sorts by quality descending', () => {
    deepStrictEqual(parseAccept('en;q=0.5, de;q=0.9, fr'), [
      { value: 'fr', q: 1 },
      { value: 'de', q: 0.9 },
      { value: 'en', q: 0.5 },
    ]);
  });

  it('keeps header order for equal weights', () => {
    deepStrictEqual(parseAccept('de, en, fr'), [
      { value: 'de', q: 1 },
      { value: 'en', q: 1 },
      { value: 'fr', q: 1 },
    ]);
  });

  it('lowercases the token and trims surrounding whitespace', () => {
    deepStrictEqual(parseAccept('  EN-US ;q=0.8 '), [{ value: 'en-us', q: 0.8 }]);
  });

  it('matches q case-insensitively', () => {
    deepStrictEqual(parseAccept('en;Q=0'), [{ value: 'en', q: 0 }]);
  });

  it('ignores media-type parameters other than q', () => {
    deepStrictEqual(parseAccept('text/html;level=1;q=0.4'), [{ value: 'text/html', q: 0.4 }]);
  });

  it('falls back to 1 on a garbled weight', () => {
    deepStrictEqual(parseAccept('en;q=abc'), [{ value: 'en', q: 1 }]);
  });

  it('clamps weights to [0, 1]', () => {
    deepStrictEqual(parseAccept('en;q=9, de;q=-2'), [
      { value: 'en', q: 1 },
      { value: 'de', q: 0 },
    ]);
  });

  it('drops empty tokens from blank input and stray commas', () => {
    deepStrictEqual(parseAccept(''), []);
    deepStrictEqual(parseAccept('en, , de,'), [
      { value: 'en', q: 1 },
      { value: 'de', q: 1 },
    ]);
  });
});

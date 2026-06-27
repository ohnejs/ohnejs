import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { languageFallbacks } from '../../../src/utils/i18n/language-fallbacks.ts';

describe('languageFallbacks', () => {
  it('drops the trailing subtag one step at a time', () => {
    deepStrictEqual(languageFallbacks('de-AT'), ['de-AT', 'de']);
  });

  it('walks every subtag of a multi-part tag', () => {
    deepStrictEqual(languageFallbacks('zh-Hant-TW'), ['zh-Hant-TW', 'zh-Hant', 'zh']);
  });

  it('returns a single-element chain for a primary tag', () => {
    deepStrictEqual(languageFallbacks('en'), ['en']);
  });

  it('trims surrounding whitespace before splitting', () => {
    deepStrictEqual(languageFallbacks('  de-AT  '), ['de-AT', 'de']);
  });

  it('returns an empty chain for a blank tag', () => {
    deepStrictEqual(languageFallbacks(''), []);
    deepStrictEqual(languageFallbacks('   '), []);
  });
});

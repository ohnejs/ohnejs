import { deepStrictEqual, ok, strictEqual } from 'node:assert';
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

  it('walks a tag with many private-use subtags in linear time', () => {
    const tag = `en-x-${Array(20_000).fill('a').join('-')}`;
    const started = performance.now();
    const chain = languageFallbacks(tag);
    const elapsed = performance.now() - started;
    strictEqual(chain.length, 20_002);
    strictEqual(chain.at(-3), 'en-x-a');
    ok(elapsed < 250, `${elapsed.toFixed(0)} ms`);
  });
});

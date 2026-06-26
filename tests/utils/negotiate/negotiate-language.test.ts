import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { negotiateLanguage } from '../../../src/utils/index.ts';

describe('negotiateLanguage', () => {
  it('picks the highest-quality offered tag', () => {
    strictEqual(negotiateLanguage('de-AT, de;q=0.9, en;q=0.5', ['en', 'de']), 'de');
  });

  it('truncates a region tag to its base language', () => {
    strictEqual(negotiateLanguage('de-AT', ['en', 'de']), 'de');
  });

  it('truncates progressively, preferring the more specific offer', () => {
    strictEqual(negotiateLanguage('zh-Hant-TW', ['zh', 'zh-Hant']), 'zh-Hant');
  });

  it('does not widen a range toward a more specific offer', () => {
    strictEqual(negotiateLanguage('en', ['en-US']), undefined);
  });

  it('returns the original casing of the offer', () => {
    strictEqual(negotiateLanguage('de-at', ['EN', 'DE']), 'DE');
  });

  it('follows client preference order over offer order', () => {
    strictEqual(negotiateLanguage('en;q=0.9, de;q=0.8', ['de', 'en']), 'en');
  });

  it('skips a tag refused with q=0', () => {
    strictEqual(negotiateLanguage('de;q=0, en', ['de', 'en']), 'en');
  });

  it('resolves * to the first offer', () => {
    strictEqual(negotiateLanguage('*', ['en', 'de']), 'en');
  });

  it('does not let * resolve to a tag refused with q=0', () => {
    strictEqual(negotiateLanguage('*, en;q=0', ['en', 'de']), 'de');
  });

  it('returns undefined when * would only resolve to a refused tag', () => {
    strictEqual(negotiateLanguage('*, en;q=0', ['en']), undefined);
  });

  it('returns undefined when nothing overlaps', () => {
    strictEqual(negotiateLanguage('fr-FR', ['en', 'de']), undefined);
  });

  it('returns undefined for an empty header', () => {
    strictEqual(negotiateLanguage('', ['en', 'de']), undefined);
  });
});

import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { canonicalizeLanguage } from '../../../src/utils/i18n/canonicalize-language.ts';

describe('canonicalizeLanguage', () => {
  it('lowercases a primary language subtag', () => {
    strictEqual(canonicalizeLanguage('EN'), 'en');
  });

  it('uppercases a region subtag', () => {
    strictEqual(canonicalizeLanguage('de-at'), 'de-AT');
    strictEqual(canonicalizeLanguage('en-us'), 'en-US');
  });

  it('Title-cases a script subtag', () => {
    strictEqual(canonicalizeLanguage('zh-hant-tw'), 'zh-Hant-TW');
  });

  it('is idempotent on an already-canonical tag', () => {
    strictEqual(canonicalizeLanguage('de-AT'), 'de-AT');
  });

  it('normalizes casing regardless of the input casing', () => {
    strictEqual(canonicalizeLanguage('DE-at'), 'de-AT');
    strictEqual(canonicalizeLanguage('ZH-HANT-tw'), 'zh-Hant-TW');
  });

  it('returns null for a structurally invalid tag', () => {
    strictEqual(canonicalizeLanguage('en_US'), null);
    strictEqual(canonicalizeLanguage('not a tag'), null);
  });

  it('returns null for an empty tag', () => {
    strictEqual(canonicalizeLanguage(''), null);
  });
});

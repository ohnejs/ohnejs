import { deepStrictEqual, strictEqual, throws } from 'node:assert';
import { afterEach, describe, it } from 'node:test';

import { useLayers } from '../../../src/ohne/layers/use-layers.ts';
import { checkQueryLocale, effectiveLocale, queryLocales } from '../../../src/ohne/query/locale.ts';

const LAYER = '/locale-test';

afterEach(() => {
  useLayers().remove(LAYER);
});

function configure(locales: string[], defaultLocale: string): void {
  useLayers().add({ path: LAYER, input: { collections: { locales, defaultLocale } } });
}

describe('queryLocales', () => {
  it('resolves the configured set, canonicalized', () => {
    configure(['en', 'de-at'], 'en');
    deepStrictEqual(queryLocales(), { locales: ['en', 'de-AT'], defaultLocale: 'en' });
  });

  it('falls back to the en-only default without config', () => {
    deepStrictEqual(queryLocales(), { locales: ['en'], defaultLocale: 'en' });
  });

  it('reads the config live, so a layer change is visible', () => {
    strictEqual(queryLocales().defaultLocale, 'en');
    configure(['de'], 'de');
    strictEqual(queryLocales().defaultLocale, 'de');
  });
});

describe('effectiveLocale', () => {
  it('keeps an explicit locale', () => {
    configure(['en', 'de'], 'en');
    strictEqual(effectiveLocale('de'), 'de');
  });

  it('resolves null to the default locale', () => {
    configure(['en', 'de'], 'de');
    strictEqual(effectiveLocale(null), 'de');
  });
});

describe('checkQueryLocale', () => {
  it('returns the canonical tag of a member', () => {
    configure(['en', 'de-at'], 'en');
    strictEqual(checkQueryLocale('de-AT'), 'de-AT');
    strictEqual(checkQueryLocale('de-at'), 'de-AT');
  });

  it('throws for a locale outside the set, naming the members', () => {
    configure(['en', 'de'], 'en');
    throws(
      () => checkQueryLocale('fr'),
      (error: Error) => error.message.includes('Unknown locale `fr`'),
    );
  });

  it('throws for a malformed tag', () => {
    configure(['en'], 'en');
    throws(() => checkQueryLocale('not a tag'));
  });
});

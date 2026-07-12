import { deepStrictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { resolveLocales } from '../../../src/ohne/collections/resolve-locales.ts';

describe('resolveLocales', () => {
  it('resolves the defaults when the group is absent', () => {
    deepStrictEqual(resolveLocales(undefined), { locales: ['en'], defaultLocale: 'en' });
    deepStrictEqual(resolveLocales({}), { locales: ['en'], defaultLocale: 'en' });
  });

  it('canonicalizes every locale and the default', () => {
    deepStrictEqual(resolveLocales({ locales: ['EN', 'de-at'], defaultLocale: 'eN' }), {
      locales: ['en', 'de-AT'],
      defaultLocale: 'en',
    });
  });

  it('rejects an invalid locale tag', () => {
    throws(() => resolveLocales({ locales: ['en_US'] }), /Invalid content locale `en_US`/);
    throws(() => resolveLocales({ locales: [''] }), /Invalid content locale/);
  });

  it('rejects an invalid default locale', () => {
    throws(
      () => resolveLocales({ locales: ['en'], defaultLocale: 'en_US' }),
      /Invalid default locale `en_US`/,
    );
  });

  it('rejects two entries canonicalizing to one tag', () => {
    throws(() => resolveLocales({ locales: ['de-AT', 'de-at'] }), /Duplicate content locale/);
  });

  it('rejects an empty locale set', () => {
    throws(() => resolveLocales({ locales: [] }), /Content locales cannot be empty/);
  });

  it('rejects a default outside the set instead of guessing', () => {
    throws(
      () => resolveLocales({ locales: ['de', 'fr'] }),
      /Default locale `en` is not a content locale/,
    );
    throws(
      () => resolveLocales({ locales: ['de', 'fr'], defaultLocale: 'it' }),
      /Default locale `it` is not a content locale/,
    );
  });
});

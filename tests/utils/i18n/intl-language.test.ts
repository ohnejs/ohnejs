import { strictEqual } from 'node:assert';
import { afterEach, describe, it } from 'node:test';

import { intlLanguage } from '../../../src/utils/i18n/intl-language.ts';

const Native = Intl.DateTimeFormat;

/**
 * Makes `Intl.DateTimeFormat` answer CLDR root placeholders like `M09` for the tags in `without`.
 */
function withoutData(...without: string[]): void {
  const Stub = function (locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
    const tag = Array.isArray(locales) ? locales[0] : locales;
    if (!tag || !without.includes(tag)) return new Native(tag, options);
    return {
      format: (date: number) => `M${String(new Date(date).getUTCMonth() + 1).padStart(2, '0')}`,
    };
  } as unknown as typeof Intl.DateTimeFormat;
  Stub.supportedLocalesOf = Native.supportedLocalesOf;
  Intl.DateTimeFormat = Stub;
}

describe('intlLanguage', () => {
  afterEach(() => {
    Intl.DateTimeFormat = Native;
  });

  it('keeps a language the engine has data for', () => {
    strictEqual(intlLanguage('de-AT'), 'de-AT');
  });

  it('falls back down the chain past a language listed without data', () => {
    withoutData('sr-Latn-BA');
    strictEqual(intlLanguage('sr-Latn-BA'), 'sr-Latn');
  });

  it('keeps an extension, probing only the base language', () => {
    strictEqual(intlLanguage('de-u-ca-chinese'), 'de-u-ca-chinese');
    withoutData('hr-HR');
    strictEqual(intlLanguage('hr-HR-u-nu-latn'), 'hr');
  });

  it("answers `undefined` when no entry has data, leaving the engine's default", () => {
    withoutData('bs-Cyrl-BA', 'bs-Cyrl', 'bs');
    strictEqual(intlLanguage('bs-Cyrl-BA'), undefined);
  });
});

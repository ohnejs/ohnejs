import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { deriveIntlData, displayName, registerIntlData } from '../../../src/utils/index.ts';

describe('displayName', () => {
  it('names each kind of code in the language', () => {
    strictEqual(displayName('DE', 'region', 'de'), 'Deutschland');
    strictEqual(displayName('BA', 'region', 'bs'), 'Bosna i Hercegovina');
    strictEqual(displayName('EUR', 'currency', 'en'), 'Euro');
    strictEqual(displayName('de', 'language', 'en'), 'German');
  });

  it('capitalizes a name the language writes in lower case', () => {
    strictEqual(displayName('EUR', 'currency', 'fr'), 'Euro');
    strictEqual(displayName('bs', 'language', 'bs'), 'Bosanski');
  });

  it('gives the code back when nothing names it, or the code or language is malformed', () => {
    strictEqual(displayName('QQ', 'region', 'en'), 'QQ');
    strictEqual(displayName('D1', 'region', 'en'), 'D1');
    strictEqual(displayName('DE', 'region', 'en_US'), 'DE');
    strictEqual(displayName('qaa', 'language', 'en'), 'qaa');
    strictEqual(displayName('de', 'region', 'en'), 'de');
  });

  it('names a language in itself even where the engine lacks its date data', () => {
    const Native = Intl.DateTimeFormat;
    const Stub = function (locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
      const tag = Array.isArray(locales) ? locales[0] : locales;
      return tag === 'hr' ? { format: () => 'M09' } : new Native(tag, options);
    } as unknown as typeof Intl.DateTimeFormat;
    Stub.supportedLocalesOf = Native.supportedLocalesOf;
    Intl.DateTimeFormat = Stub;
    try {
      strictEqual(displayName('hr', 'language', 'hr'), 'Hrvatski');
    } finally {
      Intl.DateTimeFormat = Native;
    }
  });

  it('reads the names of a language the engine lacks from its registered `IntlData`', () => {
    const Native = Intl.DateTimeFormat;
    const Stub = function (locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
      const tag = Array.isArray(locales) ? locales[0] : locales;
      return tag === 'tlh' ? { format: () => 'M09' } : new Native(tag, options);
    } as unknown as typeof Intl.DateTimeFormat;
    Stub.supportedLocalesOf = Native.supportedLocalesOf;
    Intl.DateTimeFormat = Stub;
    try {
      registerIntlData('tlh', deriveIntlData('de'));
      strictEqual(displayName('DE', 'region', 'tlh'), 'Deutschland');
      strictEqual(displayName('JPY', 'currency', 'tlh'), 'Japanischer Yen');
      strictEqual(displayName('toString', 'region', 'tlh'), 'toString');
    } finally {
      Intl.DateTimeFormat = Native;
    }
  });
});

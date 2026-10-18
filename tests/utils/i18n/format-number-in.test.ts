import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { formatNumberIn } from '../../../src/utils/i18n/format-number-in.ts';
import { deriveIntlData, registerIntlData } from '../../../src/utils/i18n/intl-data.ts';

describe('formatNumberIn', () => {
  it('formats in the language the engine has data for', () => {
    strictEqual(formatNumberIn(12_345.6, 'en'), '12,345.6');
    strictEqual(formatNumberIn(12_345.6, 'de'), '12.345,6');
  });

  it('passes the format options through', () => {
    strictEqual(formatNumberIn(0.25, 'en', { style: 'percent' }), '25%');
    strictEqual(formatNumberIn(2.345, 'en', { maximumFractionDigits: 1 }), '2.3');
  });

  it('swaps in the registered separators of a language the engine lacks', () => {
    const bosnian = deriveIntlData('bs');
    const Native = Intl.DateTimeFormat;
    const Stub = function (locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
      const tag = Array.isArray(locales) ? locales[0] : locales;
      return tag === 'bs' ? { format: () => 'M09' } : new Native(tag, options);
    } as unknown as typeof Intl.DateTimeFormat;
    Stub.supportedLocalesOf = Native.supportedLocalesOf;
    Intl.DateTimeFormat = Stub;
    try {
      registerIntlData('bs', bosnian);
      strictEqual(formatNumberIn(12_345.6, 'bs'), '12.345,6');
    } finally {
      Intl.DateTimeFormat = Native;
    }
  });

  it('formats a decimal string exactly', () => {
    strictEqual(formatNumberIn('90071992547409.91', 'en'), '90,071,992,547,409.91');
  });
});

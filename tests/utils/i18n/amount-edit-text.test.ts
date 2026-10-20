import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import {
  amountEditText,
  deriveIntlData,
  parseMinorUnits,
  registerIntlData,
} from '../../../src/utils/index.ts';

describe('amountEditText', () => {
  it("uses the language's decimal mark, without grouping", () => {
    strictEqual(amountEditText(123450, 2, 'de'), '1234,50');
    strictEqual(amountEditText(123450, 2, 'en'), '1234.50');
    strictEqual(amountEditText(1234, 0, 'en'), '1234');
  });

  it('keeps ASCII digits, so the text parses back', () => {
    for (const language of ['ar-EG', 'fa', 'de']) {
      strictEqual(parseMinorUnits(amountEditText(123450, 2, language), 2), 123450, language);
    }
  });

  it('writes a negative amount with an ASCII minus, so it parses back too', () => {
    for (const language of ['sv', 'fi', 'he', 'ar-EG', 'fa', 'de']) {
      strictEqual(parseMinorUnits(amountEditText(-1234, 2, language), 2), -1234, language);
    }
  });

  it('parses back in a language the engine lacks, written with its registered separators', () => {
    const Real = Intl.DateTimeFormat;
    // The engine answers a tag it lacks with CLDR root month names like `M09`.
    Intl.DateTimeFormat = function (tag: string, options?: Intl.DateTimeFormatOptions) {
      return tag.startsWith('tlh') ? { format: () => 'M09' } : new Real(tag, options);
    } as unknown as typeof Intl.DateTimeFormat;
    try {
      registerIntlData('tlh', { ...deriveIntlData('fa'), number: { decimal: '٫', group: '٬' } });
      strictEqual(parseMinorUnits(amountEditText(123450, 2, 'tlh'), 2), 123450);
    } finally {
      Intl.DateTimeFormat = Real;
    }
  });
});

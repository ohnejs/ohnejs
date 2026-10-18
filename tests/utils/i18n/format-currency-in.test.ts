import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { formatCurrencyIn } from '../../../src/utils/index.ts';

const nbsp = (text: string): string => text.replaceAll(' ', '\u00a0');

describe('formatCurrencyIn', () => {
  it('writes minor units as money with the ISO digits', () => {
    strictEqual(formatCurrencyIn(1234, 'EUR', 'de'), nbsp('12,34 €'));
    strictEqual(formatCurrencyIn(1234, 'JPY', 'en'), '¥1,234');
    strictEqual(formatCurrencyIn(1234, 'KWD', 'en'), nbsp('KWD 1.234'));
    strictEqual(formatCurrencyIn(1234, 'HUF', 'hu'), nbsp('12,34 Ft'));
    strictEqual(formatCurrencyIn(1234, 'BAM', 'bs'), nbsp('12,34 KM'));
  });

  it('keeps the last cent of the safe range', () => {
    strictEqual(formatCurrencyIn(9007199254740991, 'EUR', 'de'), nbsp('90.071.992.547.409,91 €'));
  });
});

import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isCurrencyCode } from '../../../src/utils/index.ts';

describe('isCurrencyCode', () => {
  it('accepts a circulating code in upper case', () => {
    strictEqual(isCurrencyCode('EUR'), true);
    strictEqual(isCurrencyCode('BAM'), true);
  });

  it('refuses lower case, unknown and fund or metal codes', () => {
    for (const value of ['eur', 'ABC', 'XAU', 'CLF', '', 978, null, 'toString']) {
      strictEqual(isCurrencyCode(value), false, String(value));
    }
  });
});

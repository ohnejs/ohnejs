import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isAmount } from '../../../src/utils/index.ts';

describe('isAmount', () => {
  it('accepts whole minor units of a known currency', () => {
    strictEqual(isAmount({ minor: 1234, currency: 'EUR' }), true);
    strictEqual(isAmount({ minor: -5, currency: 'JPY' }), true);
  });

  it('refuses anything else', () => {
    const values = [
      { minor: 1.5, currency: 'EUR' },
      { minor: 1, currency: 'eur' },
      { minor: 1, currency: 'EUR', label: 'fee' },
      { minor: 1 },
      [1, 'EUR'],
      null,
      '12.34 EUR',
    ];
    for (const value of values) strictEqual(isAmount(value), false, JSON.stringify(value));
  });
});

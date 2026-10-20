import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { amountWithCode } from '../../../src/utils/index.ts';

describe('amountWithCode', () => {
  it('writes the exact major amount beside the code', () => {
    strictEqual(amountWithCode(1234, 'EUR'), '12.34 EUR');
    strictEqual(amountWithCode(-5, 'EUR'), '-0.05 EUR');
    strictEqual(amountWithCode(1234, 'JPY'), '1234 JPY');
  });
});

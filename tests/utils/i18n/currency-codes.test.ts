import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { currencyCodes, currencyDigits } from '../../../src/utils/index.ts';

describe('currencyCodes', () => {
  it('lists every key of `currencyDigits`, sorted', () => {
    deepStrictEqual(currencyCodes, Object.keys(currencyDigits));
    deepStrictEqual([...currencyCodes].sort(), [...currencyCodes]);
  });
});

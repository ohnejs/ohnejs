import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { currencyAffixIn } from '../../../src/utils/index.ts';

describe('currencyAffixIn', () => {
  it('finds the side and the symbol the language writes', () => {
    deepStrictEqual(currencyAffixIn('USD', 'en'), { side: 'prefix', symbol: '$' });
    deepStrictEqual(currencyAffixIn('EUR', 'de'), { side: 'suffix', symbol: '€' });
    deepStrictEqual(currencyAffixIn('BAM', 'bs'), { side: 'suffix', symbol: 'KM' });
  });
});

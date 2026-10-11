import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { checkCount } from '../../../src/utils/validate/check-count.ts';

describe('checkCount', () => {
  it('fails a size outside the inclusive bounds', () => {
    deepStrictEqual(checkCount(0, { min: 1 }), { key: 'validation.minItems', params: { min: 1 } });
    deepStrictEqual(checkCount(4, { max: 3 }), { key: 'validation.maxItems', params: { max: 3 } });
  });

  it('passes a size within the bounds', () => {
    strictEqual(checkCount(3, { min: 3, max: 3 }), undefined);
    strictEqual(checkCount(0, {}), undefined);
  });
});

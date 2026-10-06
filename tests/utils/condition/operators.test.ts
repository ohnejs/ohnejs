import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isCompareOperator } from '../../../src/utils/condition/operators.ts';

describe('isCompareOperator', () => {
  it('accepts a compare operator', () => {
    strictEqual(isCompareOperator('atLeast'), true);
    strictEqual(isCompareOperator('isNull'), true);
  });

  it('rejects a node kind and an inherited name', () => {
    strictEqual(isCompareOperator('has'), false);
    strictEqual(isCompareOperator('empty'), false);
    strictEqual(isCompareOperator('toString'), false);
  });
});

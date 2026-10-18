import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { checkDuration } from '../../../src/utils/index.ts';

describe('checkDuration', () => {
  it('names a failing bound in canonical text, given as text or ms', () => {
    deepStrictEqual(checkDuration(60_000, { min: '5m' }), {
      key: 'validation.minValue',
      params: { min: '5m' },
    });
    deepStrictEqual(checkDuration(7_200_001, { max: 7_200_000 }), {
      key: 'validation.maxValue',
      params: { max: '2h' },
    });
  });

  it('passes a duration within bounds', () => {
    strictEqual(checkDuration(600_000, { min: 0, max: '1h' }), undefined);
  });

  it('never fails on a bound that does not parse', () => {
    strictEqual(checkDuration(1, { min: 'soon' }), undefined);
  });
});

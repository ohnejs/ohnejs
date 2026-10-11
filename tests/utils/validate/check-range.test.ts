import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { checkRange } from '../../../src/utils/validate/check-range.ts';

describe('checkRange', () => {
  it('fails a number outside the inclusive bounds', () => {
    deepStrictEqual(checkRange(0, { min: 1 }), { key: 'validation.minValue', params: { min: 1 } });
    deepStrictEqual(checkRange(11, { max: 10 }), {
      key: 'validation.maxValue',
      params: { max: 10 },
    });
    strictEqual(checkRange(-5, { min: -5, max: 5 }), undefined);
  });

  it('compares ISO strings in order', () => {
    deepStrictEqual(checkRange('2025-12-31', { min: '2026-01-01' }), {
      key: 'validation.minValue',
      params: { min: '2026-01-01' },
    });
    strictEqual(checkRange('2026-01-02', { min: '2026-01-01', max: '2026-02-01' }), undefined);
  });
});

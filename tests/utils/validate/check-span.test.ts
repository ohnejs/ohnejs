import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { checkSpan } from '../../../src/utils/index.ts';

describe('checkSpan', () => {
  it('refuses a span that runs backwards', () => {
    strictEqual(checkSpan(5, 1, {}), 'validation.invalidRange');
  });

  it('passes a span of 0', () => {
    strictEqual(checkSpan(5, 5, {}), undefined);
  });

  it('names a short or long span in canonical text', () => {
    deepStrictEqual(checkSpan(0, 3_600_000, { min: '1 day' }), {
      key: 'validation.minSpan',
      params: { min: '1d' },
    });
    deepStrictEqual(checkSpan(0, 90_000_000, { max: 86_400_000 }), {
      key: 'validation.maxSpan',
      params: { max: '1d' },
    });
  });

  it('never fails on a bound that does not parse', () => {
    strictEqual(checkSpan(0, 1, { min: 'soon' }), undefined);
  });
});

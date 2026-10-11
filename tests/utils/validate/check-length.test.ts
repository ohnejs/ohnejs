import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { checkLength } from '../../../src/utils/validate/check-length.ts';

describe('checkLength', () => {
  it('fails a length outside the inclusive bounds', () => {
    deepStrictEqual(checkLength(2, { min: 3 }), {
      key: 'validation.minLength',
      params: { min: 3 },
    });
    deepStrictEqual(checkLength(9, { max: 8 }), {
      key: 'validation.maxLength',
      params: { max: 8 },
    });
  });

  it('passes the bounds themselves and an unbounded length', () => {
    strictEqual(checkLength(3, { min: 3, max: 3 }), undefined);
    strictEqual(checkLength(1000, {}), undefined);
    strictEqual(checkLength(0, { min: undefined, max: undefined }), undefined);
  });
});

import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { checkListSize } from '../../../src/uploads/fields/_constraints.ts';

describe('checkListSize', () => {
  it('rejects a provided empty list under `allowEmpty: false`', () => {
    strictEqual(checkListSize([], { allowEmpty: false }), 'validation.emptyValue');
  });

  it('accepts an empty list under `allowEmpty: true`', () => {
    strictEqual(checkListSize([], { allowEmpty: true }), undefined);
  });

  it('rejects a list below `min`', () => {
    deepStrictEqual(checkListSize(['u1'], { allowEmpty: true, min: 2 }), {
      key: 'validation.minItems',
      params: { min: 2 },
    });
  });

  it('rejects a list above `max`', () => {
    deepStrictEqual(checkListSize(['u1', 'u2', 'u3'], { allowEmpty: true, max: 2 }), {
      key: 'validation.maxItems',
      params: { max: 2 },
    });
  });

  it('accepts a list within bounds', () => {
    strictEqual(checkListSize(['u1', 'u2'], { allowEmpty: true, min: 1, max: 3 }), undefined);
  });

  it('passes a non-list untouched', () => {
    strictEqual(checkListSize('nope', { allowEmpty: false, min: 1 }), undefined);
    strictEqual(checkListSize(null, { allowEmpty: false, max: 0 }), undefined);
  });
});

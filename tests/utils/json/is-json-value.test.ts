import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isJSONValue } from '../../../src/utils/index.ts';

describe('isJSONValue', () => {
  it('returns true for JSON primitives', () => {
    strictEqual(isJSONValue(null), true);
    strictEqual(isJSONValue('a'), true);
    strictEqual(isJSONValue(''), true);
    strictEqual(isJSONValue(true), true);
    strictEqual(isJSONValue(false), true);
    strictEqual(isJSONValue(0), true);
    strictEqual(isJSONValue(-1.5), true);
  });

  it('returns true for arrays and plain objects of JSON values', () => {
    strictEqual(isJSONValue([]), true);
    strictEqual(isJSONValue([1, 'a', null, [true]]), true);
    strictEqual(isJSONValue({}), true);
    strictEqual(isJSONValue({ tags: ['a', 'b'], max: 3, meta: { deep: null } }), true);
  });

  it('returns false for numbers JSON cannot keep', () => {
    strictEqual(isJSONValue(NaN), false);
    strictEqual(isJSONValue(Infinity), false);
    strictEqual(isJSONValue(-Infinity), false);
  });

  it('returns false for values JSON would drop or distort', () => {
    strictEqual(isJSONValue(undefined), false);
    strictEqual(
      isJSONValue(() => 1),
      false,
    );
    strictEqual(isJSONValue(Symbol('x')), false);
    strictEqual(isJSONValue(10n), false);
    strictEqual(isJSONValue(new Date()), false);
    strictEqual(isJSONValue(new Map()), false);
  });

  it('returns false when a nested value fails', () => {
    strictEqual(isJSONValue([1, () => 2]), false);
    strictEqual(isJSONValue({ when: new Date() }), false);
    strictEqual(isJSONValue({ deep: { n: NaN } }), false);
    strictEqual(isJSONValue([[undefined]]), false);
  });
});

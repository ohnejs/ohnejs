import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isObject } from '../../../src/utils/index.ts';

describe('isObject', () => {
  it('returns true for object literals', () => {
    strictEqual(isObject({}), true);
    strictEqual(isObject({ a: 1 }), true);
  });

  it('returns true for class instances', () => {
    strictEqual(isObject(new Map()), true);
    strictEqual(isObject(new Set()), true);
    strictEqual(isObject(new Date()), true);
  });

  it('returns false for null, arrays, primitives, functions', () => {
    strictEqual(isObject(null), false);
    strictEqual(isObject([]), false);
    strictEqual(isObject('x'), false);
    strictEqual(isObject(1), false);
    strictEqual(
      isObject(() => 0),
      false,
    );
  });
});

import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isPlainObject } from '../../../src/utils/index.ts';

describe('isPlainObject', () => {
  it('returns true for plain object literals', () => {
    strictEqual(isPlainObject({}), true);
    strictEqual(isPlainObject({ a: 1 }), true);
  });

  it('returns true for objects with null prototype', () => {
    strictEqual(isPlainObject(Object.create(null)), true);
  });

  it('returns false for class instances', () => {
    strictEqual(isPlainObject(new Map()), false);
    strictEqual(isPlainObject(new Set()), false);
    strictEqual(isPlainObject(new Date()), false);
  });

  it('returns false for arrays, null, primitives', () => {
    strictEqual(isPlainObject([]), false);
    strictEqual(isPlainObject(null), false);
    strictEqual(isPlainObject('x'), false);
  });
});

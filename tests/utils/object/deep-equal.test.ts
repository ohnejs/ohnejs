import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { deepEqual } from '../../../src/utils/index.ts';

describe('deepEqual', () => {
  it('compares primitives with Object.is semantics', () => {
    strictEqual(deepEqual(1, 1), true);
    strictEqual(deepEqual('a', 'b'), false);
    strictEqual(deepEqual(NaN, NaN), true);
    strictEqual(deepEqual(0, -0), false);
    strictEqual(deepEqual(null, null), true);
    strictEqual(deepEqual(null, undefined), false);
  });

  it('distinguishes null from an empty object', () => {
    strictEqual(deepEqual(null, {}), false);
    strictEqual(deepEqual({}, null), false);
  });

  it('compares nested objects structurally', () => {
    strictEqual(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }), true);
    strictEqual(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 3 }] }), false);
  });

  it('ignores object key order', () => {
    strictEqual(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 }), true);
  });

  it('rejects a missing or extra key', () => {
    strictEqual(deepEqual({ a: 1 }, { a: 1, b: 2 }), false);
    strictEqual(deepEqual({ a: 1, b: 2 }, { a: 1 }), false);
    strictEqual(deepEqual({ a: 1 }, { b: 1 }), false);
  });

  it('compares arrays by length and element order', () => {
    strictEqual(deepEqual([1, 2], [1, 2]), true);
    strictEqual(deepEqual([1, 2], [2, 1]), false);
    strictEqual(deepEqual([1, 2], [1, 2, 3]), false);
  });

  it('treats a null-prototype object as equal to a literal', () => {
    const row = Object.assign(Object.create(null), { id: 1, name: 'a' });
    strictEqual(deepEqual(row, { id: 1, name: 'a' }), true);
  });

  it('does not match an array against an object', () => {
    strictEqual(deepEqual([], {}), false);
  });

  it('compares non-plain objects by reference only', () => {
    const date = new Date(0);
    strictEqual(deepEqual(date, date), true);
    strictEqual(deepEqual(new Date(0), new Date(0)), false);
  });
});

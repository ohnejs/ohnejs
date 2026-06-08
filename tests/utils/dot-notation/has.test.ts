import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { has } from '../../../src/utils/index.ts';

describe('has', () => {
  it('returns true for a present top-level key', () => {
    strictEqual(has({ a: 1 }, 'a'), true);
  });

  it('returns true for a present nested key', () => {
    strictEqual(has({ a: { b: { c: 1 } } }, 'a.b.c'), true);
  });

  it('returns true for a present array index', () => {
    strictEqual(has({ a: [1, 2, 3] }, 'a[2]'), true);
  });

  it('returns true even when the resolved value is undefined', () => {
    strictEqual(has({ a: undefined }, 'a'), true);
    strictEqual(has({ a: { b: undefined } }, 'a.b'), true);
  });

  it('returns false for a missing key', () => {
    strictEqual(has({ a: 1 }, 'b'), false);
  });

  it('returns false for an out-of-bounds array index', () => {
    strictEqual(has({ a: [1, 2] }, 'a[5]'), false);
  });

  it('returns false when an intermediate is null', () => {
    strictEqual(has({ a: null }, 'a.b'), false);
  });

  it('returns false when an intermediate is a primitive', () => {
    strictEqual(has({ a: 1 }, 'a.b'), false);
  });

  it('returns false for inherited keys', () => {
    strictEqual(has({}, 'toString'), false);
    const obj = Object.create({ inherited: 1 }) as { inherited?: number };
    strictEqual(has(obj, 'inherited'), false);
  });

  it('returns false for a null root', () => {
    strictEqual(has(null, 'a'), false);
  });

  it('returns false for an undefined root', () => {
    strictEqual(has(undefined, 'a'), false);
  });

  it('treats Map as a leaf', () => {
    strictEqual(has(new Map([['k', 1]]), 'k'), false);
  });

  it('treats class instances as leaves', () => {
    class Foo {
      x = 1;
    }
    strictEqual(has(new Foo(), 'x'), false);
  });

  it('does not descend into non-plain intermediates', () => {
    strictEqual(has({ a: new Map([['k', 1]]) }, 'a.k'), false);
  });
});

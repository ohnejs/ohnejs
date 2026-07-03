import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { dotHas } from '../../../src/utils/index.ts';

describe('dotHas', () => {
  it('returns true for a present top-level key', () => {
    strictEqual(dotHas({ a: 1 }, 'a'), true);
  });

  it('returns true for a present nested key', () => {
    strictEqual(dotHas({ a: { b: { c: 1 } } }, 'a.b.c'), true);
  });

  it('returns true for a present array index', () => {
    strictEqual(dotHas({ a: [1, 2, 3] }, 'a[2]'), true);
  });

  it('returns true even when the resolved value is undefined', () => {
    strictEqual(dotHas({ a: undefined }, 'a'), true);
    strictEqual(dotHas({ a: { b: undefined } }, 'a.b'), true);
  });

  it('returns false for a missing key', () => {
    strictEqual(dotHas({ a: 1 }, 'b'), false);
  });

  it('returns false for a .key segment on an array', () => {
    const arr: number[] & { tag?: string } = [1, 2];
    arr.tag = 'x';
    strictEqual(dotHas({ a: arr }, 'a.tag'), false);
  });

  it('returns false for an [n] segment on a plain object', () => {
    strictEqual(dotHas({ a: { 0: 'x' } }, 'a[0]'), false);
  });

  it('returns false for an out-of-bounds array index', () => {
    strictEqual(dotHas({ a: [1, 2] }, 'a[5]'), false);
  });

  it('returns false when an intermediate is null', () => {
    strictEqual(dotHas({ a: null }, 'a.b'), false);
  });

  it('returns false when an intermediate is a primitive', () => {
    strictEqual(dotHas({ a: 1 }, 'a.b'), false);
  });

  it('returns false for inherited keys', () => {
    strictEqual(dotHas({}, 'toString'), false);
    const obj = Object.create({ inherited: 1 }) as { inherited?: number };
    strictEqual(dotHas(obj, 'inherited'), false);
  });

  it('returns false for a null root', () => {
    strictEqual(dotHas(null, 'a'), false);
  });

  it('returns false for an undefined root', () => {
    strictEqual(dotHas(undefined, 'a'), false);
  });

  it('treats Map as a leaf', () => {
    strictEqual(dotHas(new Map([['k', 1]]), 'k'), false);
  });

  it('treats class instances as leaves', () => {
    class Foo {
      x = 1;
    }
    strictEqual(dotHas(new Foo(), 'x'), false);
  });

  it('does not descend into non-plain intermediates', () => {
    strictEqual(dotHas({ a: new Map([['k', 1]]) }, 'a.k'), false);
  });
});

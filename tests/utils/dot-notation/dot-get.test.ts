import { strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { dotGet } from '../../../src/utils/index.ts';

describe('dotGet', () => {
  it('returns a top-level value', () => {
    strictEqual(dotGet({ a: 1 }, 'a'), 1);
  });

  it('returns a nested value', () => {
    strictEqual(dotGet({ a: { b: { c: 42 } } }, 'a.b.c'), 42);
  });

  it('returns an array element via [n]', () => {
    strictEqual(dotGet({ a: [10, 20, 30] }, 'a[1]'), 20);
  });

  it('returns a value at a mixed path', () => {
    strictEqual(dotGet({ a: [{ b: 'x' }, { b: 'y' }] }, 'a[1].b'), 'y');
  });

  it('returns undefined when a key is missing', () => {
    strictEqual(dotGet({ a: 1 }, 'b'), undefined);
  });

  it('returns undefined when an intermediate is null', () => {
    strictEqual(dotGet({ a: null }, 'a.b'), undefined);
  });

  it('returns undefined when an intermediate is undefined', () => {
    strictEqual(dotGet({ a: undefined }, 'a.b'), undefined);
  });

  it('returns undefined when an intermediate is a primitive', () => {
    strictEqual(dotGet({ a: 1 }, 'a.b'), undefined);
  });

  it('returns undefined for an out-of-bounds index', () => {
    strictEqual(dotGet({ a: [1, 2] }, 'a[5]'), undefined);
  });

  it('returns the literal value when present and undefined', () => {
    strictEqual(dotGet({ a: undefined }, 'a'), undefined);
  });

  it('returns undefined for a null root', () => {
    strictEqual(dotGet(null, 'a'), undefined);
  });

  it('returns undefined for an undefined root', () => {
    strictEqual(dotGet(undefined, 'a'), undefined);
  });

  it('throws on an invalid path', () => {
    throws(() => dotGet({ a: 1 }, ''), /empty/);
  });

  it('treats Map as a leaf', () => {
    strictEqual(dotGet(new Map([['k', 1]]), 'k'), undefined);
  });

  it('treats class instances as leaves', () => {
    class Foo {
      x = 1;
    }
    strictEqual(dotGet(new Foo(), 'x'), undefined);
  });

  it('does not descend into non-plain intermediates', () => {
    strictEqual(dotGet({ a: new Map([['k', 1]]) }, 'a.k'), undefined);
  });
});

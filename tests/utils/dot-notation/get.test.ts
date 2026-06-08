import { strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { get } from '../../../src/utils/index.ts';

describe('get', () => {
  it('returns a top-level value', () => {
    strictEqual(get({ a: 1 }, 'a'), 1);
  });

  it('returns a nested value', () => {
    strictEqual(get({ a: { b: { c: 42 } } }, 'a.b.c'), 42);
  });

  it('returns an array element via [n]', () => {
    strictEqual(get({ a: [10, 20, 30] }, 'a[1]'), 20);
  });

  it('returns a value at a mixed path', () => {
    strictEqual(get({ a: [{ b: 'x' }, { b: 'y' }] }, 'a[1].b'), 'y');
  });

  it('returns undefined when a key is missing', () => {
    strictEqual(get({ a: 1 }, 'b'), undefined);
  });

  it('returns undefined when an intermediate is null', () => {
    strictEqual(get({ a: null }, 'a.b'), undefined);
  });

  it('returns undefined when an intermediate is undefined', () => {
    strictEqual(get({ a: undefined }, 'a.b'), undefined);
  });

  it('returns undefined when an intermediate is a primitive', () => {
    strictEqual(get({ a: 1 }, 'a.b'), undefined);
  });

  it('returns undefined for an out-of-bounds index', () => {
    strictEqual(get({ a: [1, 2] }, 'a[5]'), undefined);
  });

  it('returns the literal value when present and undefined', () => {
    strictEqual(get({ a: undefined }, 'a'), undefined);
  });

  it('returns undefined for a null root', () => {
    strictEqual(get(null, 'a'), undefined);
  });

  it('returns undefined for an undefined root', () => {
    strictEqual(get(undefined, 'a'), undefined);
  });

  it('throws on an invalid path', () => {
    throws(() => get({ a: 1 }, ''), /empty/);
  });

  it('treats Map as a leaf', () => {
    strictEqual(get(new Map([['k', 1]]), 'k'), undefined);
  });

  it('treats class instances as leaves', () => {
    class Foo {
      x = 1;
    }
    strictEqual(get(new Foo(), 'x'), undefined);
  });

  it('does not descend into non-plain intermediates', () => {
    strictEqual(get({ a: new Map([['k', 1]]) }, 'a.k'), undefined);
  });
});

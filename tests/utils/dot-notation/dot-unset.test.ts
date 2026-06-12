import { deepStrictEqual, notStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { dotUnset } from '../../../src/utils/index.ts';

describe('dotUnset', () => {
  it('removes a top-level key', () => {
    deepStrictEqual(dotUnset({ a: 1, b: 2 }, 'a'), { b: 2 });
  });

  it('removes a nested key', () => {
    deepStrictEqual(dotUnset({ a: { b: 1, c: 2 } }, 'a.b'), { a: { c: 2 } });
  });

  it('splices an array element via [n]', () => {
    deepStrictEqual(dotUnset({ a: [1, 2, 3] }, 'a[1]'), { a: [1, 3] });
  });

  it('deletes a named property on an array without splicing', () => {
    const arr: number[] & { tag?: string } = [1, 2, 3];
    arr.tag = 'x';
    const out = dotUnset({ a: arr }, 'a.tag') as { a: number[] & { tag?: string } };
    deepStrictEqual(out.a, [1, 2, 3]);
    strictEqual(out.a.tag, undefined);
    strictEqual(Object.hasOwn(out.a, 'tag'), false);
  });

  it('returns the input unchanged when the path is missing', () => {
    const input = { a: 1 };
    strictEqual(dotUnset(input, 'b'), input);
  });

  it('returns the input unchanged when an intermediate is missing', () => {
    const input = { a: { b: 1 } };
    strictEqual(dotUnset(input, 'a.c.d'), input);
  });

  it('returns the input unchanged when an intermediate is a primitive', () => {
    const input = { a: 1 };
    strictEqual(dotUnset(input, 'a.b'), input);
  });

  it('returns the input unchanged when the root is null', () => {
    strictEqual(dotUnset(null, 'a'), null);
  });

  it('does not mutate the input', () => {
    const input = { a: { b: 1, c: 2 } };
    const snapshot = { a: { b: 1, c: 2 } };
    dotUnset(input, 'a.b');
    deepStrictEqual(input, snapshot);
  });

  it('shares unchanged siblings by reference (structural sharing)', () => {
    const sibling = { unchanged: true };
    const input = { a: { b: 1 }, c: sibling };
    const out = dotUnset(input, 'a.b') as typeof input;
    strictEqual(out.c, sibling);
    notStrictEqual(out.a, input.a);
  });

  it('returns a new top-level reference when a change occurred', () => {
    const input = { a: 1 };
    notStrictEqual(dotUnset(input, 'a'), input);
  });

  it('returns false from has after unset', () => {
    const out = dotUnset({ a: { b: 1 } }, 'a.b') as { a: Record<string, unknown> };
    strictEqual(Object.hasOwn(out.a, 'b'), false);
  });

  it('treats Map as a leaf and returns it unchanged', () => {
    const map = new Map([['k', 1]]);
    strictEqual(dotUnset(map, 'k'), map);
  });

  it('does not descend into non-plain intermediates', () => {
    const input = { a: new Map([['k', 1]]) };
    strictEqual(dotUnset(input, 'a.k'), input);
  });

  it('returns the input unchanged when the path contains __proto__', () => {
    const input = { a: 1 };
    strictEqual(dotUnset(input, '__proto__'), input);
  });

  it('returns the input unchanged when the path contains constructor', () => {
    const input = { a: 1 };
    strictEqual(dotUnset(input, 'constructor.prototype.x'), input);
  });

  it('does not throw when the trailing key targets a non-configurable own property', () => {
    const input = { a: [1, 2, 3] };
    const out = dotUnset(input, 'a.length') as { a: number[] };
    deepStrictEqual(out.a, [1, 2, 3]);
  });
});

import { deepStrictEqual, notStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { dotSet } from '../../../src/utils/index.ts';

describe('dotSet', () => {
  it('sets a top-level key', () => {
    deepStrictEqual(dotSet({ a: 1 }, 'a', 2), { a: 2 });
  });

  it('sets a nested key', () => {
    deepStrictEqual(dotSet({ a: { b: 1 } }, 'a.b', 2), { a: { b: 2 } });
  });

  it('clones arrays as element lists when writing through them', () => {
    const arr: { b: number }[] & { meta?: string } = [{ b: 1 }];
    arr.meta = 'x';
    const out = dotSet({ a: arr }, 'a[0].b', 2);
    deepStrictEqual(out, { a: [{ b: 2 }] });
    strictEqual(Object.hasOwn(out.a, 'meta'), false);
  });

  it('sets an array element via [n]', () => {
    deepStrictEqual(dotSet({ a: [1, 2, 3] }, 'a[1]', 9), { a: [1, 9, 3] });
  });

  it('extends an array beyond its length (leaving holes)', () => {
    const out = dotSet({ a: [1] }, 'a[2]', 'x') as { a: unknown[] };
    strictEqual(out.a.length, 3);
    strictEqual(out.a[0], 1);
    strictEqual(out.a[2], 'x');
    strictEqual(Object.hasOwn(out.a, 1), false);
  });

  it('adds a new key without affecting siblings', () => {
    const input = { a: 1, b: 2 };
    const out = dotSet(input, 'c', 3);
    deepStrictEqual(out, { a: 1, b: 2, c: 3 });
  });

  it('auto-creates an object for a key segment on a missing parent', () => {
    deepStrictEqual(dotSet({} as Record<string, unknown>, 'a.b.c', 1), { a: { b: { c: 1 } } });
  });

  it('auto-creates an array for an index segment on a missing parent', () => {
    deepStrictEqual(dotSet({} as Record<string, unknown>, 'a[0].b', 1), { a: [{ b: 1 }] });
  });

  it('auto-creates nested arrays', () => {
    const out = dotSet(undefined as unknown, '[0][1]', 'x') as unknown[][];
    strictEqual(out.length, 1);
    strictEqual(out[0]?.length, 2);
    strictEqual(out[0]?.[1], 'x');
    strictEqual(Object.hasOwn(out[0]!, 0), false);
  });

  it('replaces a primitive parent when descending through a key segment', () => {
    deepStrictEqual(dotSet({ a: 1 }, 'a.b', 2), { a: { b: 2 } });
  });

  it('replaces an array when the next segment is a key', () => {
    deepStrictEqual(dotSet({ a: [1, 2] }, 'a.b', 3), { a: { b: 3 } });
  });

  it('replaces an object when the next segment is an index', () => {
    deepStrictEqual(dotSet({ a: { x: 1 } }, 'a[0]', 'y'), { a: ['y'] });
  });

  it('does not mutate the input', () => {
    const input = { a: { b: 1, c: 2 } };
    const snapshot = { a: { b: 1, c: 2 } };
    dotSet(input, 'a.b', 99);
    deepStrictEqual(input, snapshot);
  });

  it('shares unchanged siblings by reference (structural sharing)', () => {
    const sibling = { unchanged: true };
    const input = { a: 1, b: sibling };
    const out = dotSet(input, 'a', 2) as typeof input;
    strictEqual(out.b, sibling);
  });

  it('shares unchanged branches by reference (structural sharing)', () => {
    const untouched = { deep: { thing: 1 } };
    const input = { a: { b: 1 }, c: untouched };
    const out = dotSet(input, 'a.b', 2) as typeof input;
    strictEqual(out.c, untouched);
    notStrictEqual(out.a, input.a);
  });

  it('returns a new top-level reference', () => {
    const input = { a: 1 };
    notStrictEqual(dotSet(input, 'a', 2), input);
  });

  it('returns the input unchanged when the path contains __proto__', () => {
    const input = { a: 1 };
    const out = dotSet(input, 'a.__proto__.polluted', true);
    strictEqual(out, input);
    strictEqual(({} as { polluted?: unknown }).polluted, undefined);
  });

  it('returns the input unchanged when the path contains constructor', () => {
    const input = { a: 1 };
    const out = dotSet(input, 'constructor.prototype.polluted', true);
    strictEqual(out, input);
    strictEqual(({} as { polluted?: unknown }).polluted, undefined);
  });

  it('returns the input unchanged when the path contains prototype', () => {
    const input = { a: 1 };
    strictEqual(dotSet(input, 'prototype', 'x'), input);
  });

  it('replaces a Map root with a plain object for a key segment', () => {
    deepStrictEqual(dotSet(new Map([['k', 1]]), 'a', 2), { a: 2 });
  });

  it('replaces a class instance with a plain object for a key segment', () => {
    class Foo {
      x = 1;
    }
    deepStrictEqual(dotSet(new Foo(), 'y', 2), { y: 2 });
  });

  it('preserves the null prototype on an intermediate', () => {
    const inner = Object.create(null) as Record<string, unknown>;
    inner.b = 1;
    const out = dotSet({ a: inner }, 'a.c', 2) as { a: Record<string, unknown> };
    strictEqual(Object.getPrototypeOf(out.a), null);
  });

  it('ignores an own `__proto__` data property on the input', () => {
    const input = JSON.parse('{"__proto__":{"polluted":true},"a":1}') as Record<string, unknown>;
    strictEqual(Object.getPrototypeOf(input), Object.prototype);
    const out = dotSet(input, 'a', 2) as Record<string, unknown>;
    strictEqual(Object.getPrototypeOf(out), Object.prototype);
    strictEqual((out as { polluted?: unknown }).polluted, undefined);
  });
});

import { deepStrictEqual, notStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { set } from '../../../src/utils/index.ts';

describe('set', () => {
  it('sets a top-level key', () => {
    deepStrictEqual(set({ a: 1 }, 'a', 2), { a: 2 });
  });

  it('sets a nested key', () => {
    deepStrictEqual(set({ a: { b: 1 } }, 'a.b', 2), { a: { b: 2 } });
  });

  it('sets an array element via [n]', () => {
    deepStrictEqual(set({ a: [1, 2, 3] }, 'a[1]', 9), { a: [1, 9, 3] });
  });

  it('extends an array beyond its length (leaving holes)', () => {
    const out = set({ a: [1] }, 'a[2]', 'x') as { a: unknown[] };
    strictEqual(out.a.length, 3);
    strictEqual(out.a[0], 1);
    strictEqual(out.a[2], 'x');
    strictEqual(Object.hasOwn(out.a, 1), false);
  });

  it('adds a new key without affecting siblings', () => {
    const input = { a: 1, b: 2 };
    const out = set(input, 'c', 3);
    deepStrictEqual(out, { a: 1, b: 2, c: 3 });
  });

  it('auto-creates an object for a key segment on a missing parent', () => {
    deepStrictEqual(set({} as Record<string, unknown>, 'a.b.c', 1), { a: { b: { c: 1 } } });
  });

  it('auto-creates an array for an index segment on a missing parent', () => {
    deepStrictEqual(set({} as Record<string, unknown>, 'a[0].b', 1), { a: [{ b: 1 }] });
  });

  it('auto-creates nested arrays', () => {
    const out = set(undefined as unknown, '[0][1]', 'x') as unknown[][];
    strictEqual(out.length, 1);
    strictEqual(out[0]?.length, 2);
    strictEqual(out[0]?.[1], 'x');
    strictEqual(Object.hasOwn(out[0]!, 0), false);
  });

  it('replaces a primitive parent when descending through a key segment', () => {
    deepStrictEqual(set({ a: 1 }, 'a.b', 2), { a: { b: 2 } });
  });

  it('replaces an array when the next segment is a key', () => {
    deepStrictEqual(set({ a: [1, 2] }, 'a.b', 3), { a: { b: 3 } });
  });

  it('replaces an object when the next segment is an index', () => {
    deepStrictEqual(set({ a: { x: 1 } }, 'a[0]', 'y'), { a: ['y'] });
  });

  it('does not mutate the input', () => {
    const input = { a: { b: 1, c: 2 } };
    const snapshot = { a: { b: 1, c: 2 } };
    set(input, 'a.b', 99);
    deepStrictEqual(input, snapshot);
  });

  it('shares unchanged siblings by reference (structural sharing)', () => {
    const sibling = { unchanged: true };
    const input = { a: 1, b: sibling };
    const out = set(input, 'a', 2) as typeof input;
    strictEqual(out.b, sibling);
  });

  it('shares unchanged branches by reference (structural sharing)', () => {
    const untouched = { deep: { thing: 1 } };
    const input = { a: { b: 1 }, c: untouched };
    const out = set(input, 'a.b', 2) as typeof input;
    strictEqual(out.c, untouched);
    notStrictEqual(out.a, input.a);
  });

  it('returns a new top-level reference', () => {
    const input = { a: 1 };
    notStrictEqual(set(input, 'a', 2), input);
  });

  it('returns the input unchanged when the path contains __proto__', () => {
    const input = { a: 1 };
    const out = set(input, 'a.__proto__.polluted', true);
    strictEqual(out, input);
    strictEqual(({} as { polluted?: unknown }).polluted, undefined);
  });

  it('returns the input unchanged when the path contains constructor', () => {
    const input = { a: 1 };
    const out = set(input, 'constructor.prototype.polluted', true);
    strictEqual(out, input);
    strictEqual(({} as { polluted?: unknown }).polluted, undefined);
  });

  it('returns the input unchanged when the path contains prototype', () => {
    const input = { a: 1 };
    strictEqual(set(input, 'prototype', 'x'), input);
  });

  it('replaces a Map root with a plain object for a key segment', () => {
    deepStrictEqual(set(new Map([['k', 1]]), 'a', 2), { a: 2 });
  });

  it('replaces a class instance with a plain object for a key segment', () => {
    class Foo {
      x = 1;
    }
    deepStrictEqual(set(new Foo(), 'y', 2), { y: 2 });
  });

  it('preserves the null prototype on an intermediate', () => {
    const inner = Object.create(null) as Record<string, unknown>;
    inner.b = 1;
    const out = set({ a: inner }, 'a.c', 2) as { a: Record<string, unknown> };
    strictEqual(Object.getPrototypeOf(out.a), null);
  });
});

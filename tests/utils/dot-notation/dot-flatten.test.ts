import { deepStrictEqual, strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { dotFlatten } from '../../../src/utils/index.ts';

describe('dotFlatten', () => {
  it('flattens a nested object', () => {
    deepStrictEqual(dotFlatten({ a: { b: 1, c: 2 } }), { 'a.b': 1, 'a.c': 2 });
  });

  it('flattens nested arrays with [n] notation', () => {
    deepStrictEqual(dotFlatten({ a: [10, 20] }), { 'a[0]': 10, 'a[1]': 20 });
  });

  it('flattens mixed nesting', () => {
    deepStrictEqual(dotFlatten({ a: { b: [{ c: 1 }, { c: 2 }] } }), {
      'a.b[0].c': 1,
      'a.b[1].c': 2,
    });
  });

  it('flattens a top-level array', () => {
    deepStrictEqual(dotFlatten([{ x: 1 }, { x: 2 }]), { '[0].x': 1, '[1].x': 2 });
  });

  it('returns an empty object for an empty object input', () => {
    deepStrictEqual(dotFlatten({}), {});
  });

  it('returns an empty object for an empty array input', () => {
    deepStrictEqual(dotFlatten([]), {});
  });

  it('preserves empty nested objects as leaves', () => {
    deepStrictEqual(dotFlatten({ a: {}, b: { c: {} } }), { a: {}, 'b.c': {} });
  });

  it('preserves empty nested arrays as leaves', () => {
    deepStrictEqual(dotFlatten({ a: [], b: { c: [] } }), { a: [], 'b.c': [] });
  });

  it('treats Date as a leaf', () => {
    const d = new Date(0);
    deepStrictEqual(dotFlatten({ a: d }), { a: d });
  });

  it('treats Map as a leaf', () => {
    const m = new Map([['k', 1]]);
    deepStrictEqual(dotFlatten({ a: m }), { a: m });
  });

  it('preserves undefined and null leaves', () => {
    deepStrictEqual(dotFlatten({ a: null, b: undefined }), { a: null, b: undefined });
  });

  it('throws on a primitive input', () => {
    throws(() => dotFlatten(1 as unknown as Record<string, unknown>), /plain object or array/);
    throws(() => dotFlatten('x' as unknown as Record<string, unknown>), /plain object or array/);
  });

  it('throws on a non-plain object input', () => {
    throws(
      () => dotFlatten(new Date() as unknown as Record<string, unknown>),
      /plain object or array/,
    );
  });

  it('throws on empty string keys', () => {
    throws(() => dotFlatten({ '': 1 }), /reserved character|is empty/);
    throws(() => dotFlatten({ a: { '': 1 } }), /reserved character|is empty/);
  });

  it('throws on keys containing "."', () => {
    throws(() => dotFlatten({ 'a.b': 1 }), /reserved character/);
    throws(() => dotFlatten({ a: { 'b.c': 1 } }), /reserved character/);
  });

  it('throws on keys containing "[" or "]"', () => {
    throws(() => dotFlatten({ 'a[0]': 1 }), /reserved character/);
    throws(() => dotFlatten({ 'a]': 1 }), /reserved character/);
  });

  it('skips an own `__proto__` key', () => {
    const objLeaf = dotFlatten(JSON.parse('{"__proto__":{},"a":1}') as Record<string, unknown>);
    strictEqual(Object.getPrototypeOf(objLeaf), Object.prototype);

    const arrLeaf = dotFlatten(JSON.parse('{"__proto__":[],"a":1}') as Record<string, unknown>);
    strictEqual(Object.getPrototypeOf(arrLeaf), Object.prototype);
  });

  it('skips own `constructor` and `prototype` keys', () => {
    const input = JSON.parse('{"constructor":1,"prototype":2,"a":3}') as Record<string, unknown>;
    deepStrictEqual(dotFlatten(input), { a: 3 });
  });
});

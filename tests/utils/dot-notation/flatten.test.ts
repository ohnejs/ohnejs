import { deepStrictEqual, strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { flatten } from '../../../src/utils/index.ts';

describe('flatten', () => {
  it('flattens a nested object', () => {
    deepStrictEqual(flatten({ a: { b: 1, c: 2 } }), { 'a.b': 1, 'a.c': 2 });
  });

  it('flattens nested arrays with [n] notation', () => {
    deepStrictEqual(flatten({ a: [10, 20] }), { 'a[0]': 10, 'a[1]': 20 });
  });

  it('flattens mixed nesting', () => {
    deepStrictEqual(flatten({ a: { b: [{ c: 1 }, { c: 2 }] } }), {
      'a.b[0].c': 1,
      'a.b[1].c': 2,
    });
  });

  it('flattens a top-level array', () => {
    deepStrictEqual(flatten([{ x: 1 }, { x: 2 }]), { '[0].x': 1, '[1].x': 2 });
  });

  it('returns an empty object for an empty object input', () => {
    deepStrictEqual(flatten({}), {});
  });

  it('returns an empty object for an empty array input', () => {
    deepStrictEqual(flatten([]), {});
  });

  it('preserves empty nested objects as leaves', () => {
    deepStrictEqual(flatten({ a: {}, b: { c: {} } }), { a: {}, 'b.c': {} });
  });

  it('preserves empty nested arrays as leaves', () => {
    deepStrictEqual(flatten({ a: [], b: { c: [] } }), { a: [], 'b.c': [] });
  });

  it('treats Date as a leaf', () => {
    const d = new Date(0);
    deepStrictEqual(flatten({ a: d }), { a: d });
  });

  it('treats Map as a leaf', () => {
    const m = new Map([['k', 1]]);
    deepStrictEqual(flatten({ a: m }), { a: m });
  });

  it('preserves undefined and null leaves', () => {
    deepStrictEqual(flatten({ a: null, b: undefined }), { a: null, b: undefined });
  });

  it('throws on a primitive input', () => {
    throws(() => flatten(1 as unknown as Record<string, unknown>), /plain object or array/);
    throws(() => flatten('x' as unknown as Record<string, unknown>), /plain object or array/);
  });

  it('throws on a non-plain object input', () => {
    throws(
      () => flatten(new Date() as unknown as Record<string, unknown>),
      /plain object or array/,
    );
  });

  it('throws on empty string keys', () => {
    throws(() => flatten({ '': 1 }), /reserved character|is empty/);
    throws(() => flatten({ a: { '': 1 } }), /reserved character|is empty/);
  });

  it('throws on keys containing "."', () => {
    throws(() => flatten({ 'a.b': 1 }), /reserved character/);
    throws(() => flatten({ a: { 'b.c': 1 } }), /reserved character/);
  });

  it('throws on keys containing "[" or "]"', () => {
    throws(() => flatten({ 'a[0]': 1 }), /reserved character/);
    throws(() => flatten({ 'a]': 1 }), /reserved character/);
  });

  it('skips an own `__proto__` key', () => {
    const objLeaf = flatten(JSON.parse('{"__proto__":{},"a":1}') as Record<string, unknown>);
    strictEqual(Object.getPrototypeOf(objLeaf), Object.prototype);

    const arrLeaf = flatten(JSON.parse('{"__proto__":[],"a":1}') as Record<string, unknown>);
    strictEqual(Object.getPrototypeOf(arrLeaf), Object.prototype);
  });

  it('skips own `constructor` and `prototype` keys', () => {
    const input = JSON.parse('{"constructor":1,"prototype":2,"a":3}') as Record<string, unknown>;
    deepStrictEqual(flatten(input), { a: 3 });
  });
});

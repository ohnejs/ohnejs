import { deepStrictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { flatten, unflatten } from '../../../src/utils/index.ts';

describe('unflatten', () => {
  it('reconstructs a nested object', () => {
    deepStrictEqual(unflatten({ 'a.b': 1, 'a.c': 2 }), { a: { b: 1, c: 2 } });
  });

  it('reconstructs nested arrays from [n] notation', () => {
    deepStrictEqual(unflatten({ 'a[0]': 10, 'a[1]': 20 }), { a: [10, 20] });
  });

  it('reconstructs mixed nesting', () => {
    deepStrictEqual(unflatten({ 'a.b[0].c': 1, 'a.b[1].c': 2 }), {
      a: { b: [{ c: 1 }, { c: 2 }] },
    });
  });

  it('reconstructs a top-level array', () => {
    deepStrictEqual(unflatten({ '[0].x': 1, '[1].x': 2 }), [{ x: 1 }, { x: 2 }]);
  });

  it('returns an empty object for an empty input', () => {
    deepStrictEqual(unflatten({}), {});
  });

  it('round-trips flatten -> unflatten for a nested structure', () => {
    const input = { a: { b: [{ c: 1 }, { c: 2 }], d: 'x' }, e: [10, 20, 30] };
    deepStrictEqual(unflatten(flatten(input)), input);
  });

  it('round-trips flatten -> unflatten preserving empty leaves', () => {
    const input = { a: {}, b: [], c: { d: {} } };
    deepStrictEqual(unflatten(flatten(input)), input);
  });

  it('round-trips a top-level array', () => {
    const input = [{ x: 1 }, { x: 2 }];
    deepStrictEqual(unflatten(flatten(input)), input);
  });

  it('throws when keys imply different root types', () => {
    throws(() => unflatten({ a: 1, '[0]': 'x' }));
  });

  it('round-trips with primitive leaves including null and undefined', () => {
    const input = { a: null, b: { c: undefined, d: 0, e: '', f: false } };
    deepStrictEqual(unflatten(flatten(input)), input);
  });

  it('preserves later-key wins when the same path is set twice', () => {
    deepStrictEqual(unflatten({ a: 1, 'a.b': 2 }), { a: { b: 2 } });
  });
});

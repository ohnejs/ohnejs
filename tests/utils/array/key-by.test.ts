import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { keyBy } from '../../../src/utils/index.ts';

const nullObj = <T extends object>(o: T): T => Object.assign(Object.create(null), o);

describe('keyBy', () => {
  it('indexes objects by a property', () => {
    const a = { id: 'a', n: 1 };
    const b = { id: 'b', n: 2 };
    deepStrictEqual(
      keyBy([a, b], (x) => x.id),
      nullObj({ a, b }),
    );
  });

  it('lets the later item win on duplicate keys', () => {
    const items = [
      { id: 'x', v: 1 },
      { id: 'x', v: 2 },
      { id: 'x', v: 3 },
    ];
    deepStrictEqual(
      keyBy(items, (x) => x.id),
      nullObj({ x: items[2] }),
    );
  });

  it('passes the index to keyFn', () => {
    deepStrictEqual(
      keyBy(['a', 'b', 'c'], (_, i) => i),
      nullObj({ 0: 'a', 1: 'b', 2: 'c' }),
    );
  });

  it('supports numeric keys', () => {
    deepStrictEqual(
      keyBy([10, 20, 30], (n) => n / 10),
      nullObj({ 1: 10, 2: 20, 3: 30 }),
    );
  });

  it('returns an empty object for an empty input', () => {
    deepStrictEqual(
      keyBy([], () => 'x'),
      nullObj({}),
    );
  });

  it('keeps the original reference as the value', () => {
    const a = { id: 'a' };
    const out = keyBy([a], (x) => x.id);
    strictEqual(out.a, a);
  });

  it('does not mutate the input', () => {
    const a = { id: 'a' };
    const b = { id: 'b' };
    const input = [a, b];
    keyBy(input, (x) => x.id);
    deepStrictEqual(input, [a, b]);
  });

  it('indexes correctly when keyFn returns inherited Object.prototype names', () => {
    const a = { v: 'a' };
    const b = { v: 'b' };
    const c = { v: 'c' };
    const d = { v: 'd' };
    const out = keyBy(
      [a, b, c, d],
      (_, i) => (['toString', '__proto__', 'constructor', 'hasOwnProperty'] as const)[i]!,
    );
    deepStrictEqual(
      out,
      nullObj({ toString: a, ['__proto__']: b, constructor: c, hasOwnProperty: d }),
    );
  });

  it('returns a null-prototype object', () => {
    strictEqual(Object.getPrototypeOf(keyBy([{ id: 'a' }], (x) => x.id)), null);
  });
});

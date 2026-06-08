import { deepStrictEqual, notStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { mapKeys } from '../../../src/utils/index.ts';

const nullObj = <T extends object>(o: T): T => Object.assign(Object.create(null), o);

describe('mapKeys', () => {
  it('re-keys each entry through the function', () => {
    deepStrictEqual(
      mapKeys({ a: 1, b: 2 }, (key) => key.toUpperCase()),
      nullObj({ A: 1, B: 2 }),
    );
  });

  it('passes the value as the second argument', () => {
    deepStrictEqual(
      mapKeys({ a: 1, b: 2 }, (key, n) => `${key}${n}`),
      nullObj({ a1: 1, b2: 2 }),
    );
  });

  it('lets the later value win on key collisions', () => {
    deepStrictEqual(
      mapKeys({ a: 1, b: 2, c: 3 }, () => 'k'),
      nullObj({ k: 3 }),
    );
  });

  it('returns an empty object for an empty input', () => {
    deepStrictEqual(
      mapKeys({}, () => 'x'),
      nullObj({}),
    );
  });

  it('skips inherited keys', () => {
    const obj = Object.create({ inherited: 'oops' }) as { inherited?: string; own: number };
    obj.own = 5;
    deepStrictEqual(
      mapKeys(obj, (key) => key),
      nullObj({ own: 5 }),
    );
  });

  it('does not mutate the input', () => {
    const input = { a: 1, b: 2 };
    mapKeys(input, (key) => key.toUpperCase());
    deepStrictEqual(input, { a: 1, b: 2 });
  });

  it('returns a new object reference', () => {
    const input = { a: 1 };
    notStrictEqual(
      mapKeys(input, (key) => key),
      input,
    );
  });

  it('returns a null-prototype object', () => {
    strictEqual(Object.getPrototypeOf(mapKeys({ a: 1 }, (key) => key)), null);
  });

  it('buckets correctly when fn returns inherited Object.prototype names', () => {
    const out = mapKeys({ a: 1, b: 2, c: 3, d: 4 }, (key) => {
      return ({ a: 'toString', b: '__proto__', c: 'constructor', d: 'hasOwnProperty' } as const)[
        key
      ];
    });
    deepStrictEqual(
      out,
      nullObj({
        toString: 1,
        ['__proto__']: 2,
        constructor: 3,
        hasOwnProperty: 4,
      }),
    );
  });
});

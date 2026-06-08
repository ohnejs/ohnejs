import { deepStrictEqual, notStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { mapValues } from '../../../src/utils/index.ts';

describe('mapValues', () => {
  it('maps each value through the function', () => {
    deepStrictEqual(
      mapValues({ a: 1, b: 2 }, (_, n) => n * 2),
      { a: 2, b: 4 },
    );
  });

  it('passes the value as the second argument', () => {
    deepStrictEqual(
      mapValues({ a: 1, b: 2 }, (key, n) => `${key}=${n}`),
      { a: 'a=1', b: 'b=2' },
    );
  });

  it('returns an empty object for an empty input', () => {
    deepStrictEqual(
      mapValues({}, () => 1),
      {},
    );
  });

  it('changes the value type', () => {
    deepStrictEqual(
      mapValues({ a: 1, b: 2 }, (_, n) => n.toString()),
      { a: '1', b: '2' },
    );
  });

  it('skips inherited keys', () => {
    const obj = Object.create({ inherited: 'oops' }) as { inherited?: string; own: number };
    obj.own = 5;
    deepStrictEqual(
      mapValues(obj, (_, n) => n),
      { own: 5 },
    );
  });

  it('does not mutate the input', () => {
    const input = { a: 1, b: 2 };
    mapValues(input, (_, n) => n * 10);
    deepStrictEqual(input, { a: 1, b: 2 });
  });

  it('returns a new object reference', () => {
    const input = { a: 1 };
    notStrictEqual(
      mapValues(input, (_, n) => n),
      input,
    );
  });
});

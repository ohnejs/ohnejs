import { deepStrictEqual, notStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { pick } from '../../../src/utils/index.ts';

describe('pick', () => {
  it('returns a new object with only the picked keys', () => {
    deepStrictEqual(pick({ a: 1, b: 2, c: 3 }, ['a', 'c']), { a: 1, c: 3 });
  });

  it('returns an empty object when no keys are picked', () => {
    deepStrictEqual(pick({ a: 1, b: 2 }, []), {});
  });

  it('preserves undefined own values', () => {
    deepStrictEqual(pick({ a: undefined, b: 2 } as { a: number | undefined; b: number }, ['a']), {
      a: undefined,
    });
  });

  it('skips keys that are not own properties', () => {
    const obj = Object.create({ inherited: 'oops' }) as { inherited?: string; own: number };
    obj.own = 1;
    deepStrictEqual(pick(obj, ['own']), { own: 1 });
  });

  it('does not mutate the input', () => {
    const input = { a: 1, b: 2, c: 3 };
    pick(input, ['a']);
    deepStrictEqual(input, { a: 1, b: 2, c: 3 });
  });

  it('returns a new object reference', () => {
    const input = { a: 1, b: 2 };
    notStrictEqual(pick(input, ['a', 'b']), input);
  });
});

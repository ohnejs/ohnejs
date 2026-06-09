import { deepStrictEqual, notStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { omit } from '../../../src/utils/index.ts';

describe('omit', () => {
  it('returns a new object without the omitted keys', () => {
    deepStrictEqual(omit({ a: 1, b: 2, c: 3 }, ['b']), { a: 1, c: 3 });
  });

  it('returns a copy when no keys are omitted', () => {
    deepStrictEqual(omit({ a: 1, b: 2 }, []), { a: 1, b: 2 });
  });

  it('returns an empty object when all keys are omitted', () => {
    deepStrictEqual(omit({ a: 1, b: 2 } as const, ['a', 'b']), {});
  });

  it('does not mutate the input', () => {
    const input = { a: 1, b: 2, c: 3 };
    omit(input, ['b']);
    deepStrictEqual(input, { a: 1, b: 2, c: 3 });
  });

  it('returns a new object reference', () => {
    const input = { a: 1, b: 2 };
    notStrictEqual(omit(input, []), input);
  });

  it('treats keys not present on the object as a no-op', () => {
    const input = { a: 1 } as { a: number; b?: number };
    deepStrictEqual(omit(input, ['b']), { a: 1 });
  });

  it('skips an own `__proto__` key', () => {
    const input = JSON.parse('{"__proto__":{"polluted":true},"a":1,"b":2}') as Record<
      string,
      unknown
    >;
    const result = omit(input, ['b']);
    strictEqual(Object.getPrototypeOf(result), Object.prototype);
    strictEqual((result as Record<string, unknown>).polluted, undefined);
  });

  it('skips own `constructor` and `prototype` keys', () => {
    const input = JSON.parse('{"constructor":1,"prototype":2,"a":3}') as Record<string, unknown>;
    const result = omit(input, []) as Record<string, unknown>;
    strictEqual(result.constructor, Object);
    strictEqual(result.prototype, undefined);
    strictEqual(result.a, 3);
  });
});

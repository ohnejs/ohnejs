import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { jsonDeserialize } from '../../../src/utils/index.ts';

describe('jsonDeserialize', () => {
  it('parses JSON arrays', () => {
    deepStrictEqual(jsonDeserialize<number[]>('[1,2,3]'), [1, 2, 3]);
  });

  it('parses JSON objects', () => {
    deepStrictEqual(jsonDeserialize<{ a: number }>('{"a":1}'), { a: 1 });
  });

  it('passes through already-parsed values', () => {
    deepStrictEqual(jsonDeserialize([1, 2, 3]), [1, 2, 3]);
    deepStrictEqual(jsonDeserialize({ a: 1 }), { a: 1 });
    strictEqual(jsonDeserialize(42), 42);
    strictEqual(jsonDeserialize(null), null);
  });

  it('returns unparseable strings as-is', () => {
    strictEqual(jsonDeserialize('not-json'), 'not-json');
  });

  it('applies a reviver bottom-up', () => {
    const out = jsonDeserialize<{ a: number; b: number }>('{"a":1,"b":2}', (_k, v) =>
      typeof v === 'number' ? v * 10 : v,
    );
    deepStrictEqual(out, { a: 10, b: 20 });
  });

  it('does not run the reviver on a passthrough value', () => {
    let called = 0;
    const out = jsonDeserialize<{ a: number }>({ a: 1 }, (_k, v) => {
      called++;
      return v;
    });
    deepStrictEqual(out, { a: 1 });
    strictEqual(called, 0);
  });
});

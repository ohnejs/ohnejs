import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { keyBy } from '../../../src/utils/index.ts';

describe('keyBy', () => {
  it('indexes objects by a property', () => {
    const a = { id: 'a', n: 1 };
    const b = { id: 'b', n: 2 };
    deepStrictEqual(
      keyBy([a, b], (x) => x.id),
      { a, b },
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
      { x: items[2] },
    );
  });

  it('passes the index to keyFn', () => {
    deepStrictEqual(
      keyBy(['a', 'b', 'c'], (_, i) => i),
      { 0: 'a', 1: 'b', 2: 'c' },
    );
  });

  it('supports numeric keys', () => {
    deepStrictEqual(
      keyBy([10, 20, 30], (n) => n / 10),
      { 1: 10, 2: 20, 3: 30 },
    );
  });

  it('returns an empty object for an empty input', () => {
    deepStrictEqual(
      keyBy([], () => 'x'),
      {},
    );
  });

  it('keeps the original reference as the value', () => {
    const a = { id: 'a' };
    const out = keyBy([a], (x) => x.id);
    strictEqual(out.a, a);
  });

  it('does not mutate the input', () => {
    const input = [{ id: 'a' }, { id: 'b' }];
    keyBy(input, (x) => x.id);
    strictEqual(input.length, 2);
  });
});

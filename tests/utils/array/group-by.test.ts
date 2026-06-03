import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { groupBy } from '../../../src/utils/index.ts';

describe('groupBy', () => {
  it('groups by a computed key', () => {
    deepStrictEqual(
      groupBy([1, 2, 3, 4], (n) => (n % 2 === 0 ? 'even' : 'odd')),
      { odd: [1, 3], even: [2, 4] },
    );
  });

  it('groups objects by a property', () => {
    const items = [
      { role: 'admin', id: 1 },
      { role: 'member', id: 2 },
      { role: 'admin', id: 3 },
    ];
    deepStrictEqual(
      groupBy(items, (x) => x.role),
      {
        admin: [items[0], items[2]],
        member: [items[1]],
      },
    );
  });

  it('preserves input order within each group', () => {
    deepStrictEqual(
      groupBy([3, 1, 4, 1, 5, 9, 2, 6], (n) => (n < 5 ? 'lo' : 'hi')),
      { lo: [3, 1, 4, 1, 2], hi: [5, 9, 6] },
    );
  });

  it('passes the index to keyFn', () => {
    deepStrictEqual(
      groupBy(['a', 'b', 'c', 'd'], (_, i) => (i % 2 === 0 ? 'e' : 'o')),
      { e: ['a', 'c'], o: ['b', 'd'] },
    );
  });

  it('supports numeric keys', () => {
    deepStrictEqual(
      groupBy([1.1, 1.9, 2.2, 2.5], (n) => Math.floor(n)),
      { 1: [1.1, 1.9], 2: [2.2, 2.5] },
    );
  });

  it('returns an empty object for an empty input', () => {
    deepStrictEqual(
      groupBy([], () => 'x'),
      {},
    );
  });

  it('does not mutate the input', () => {
    const input = [1, 2, 3];
    groupBy(input, (n) => n);
    deepStrictEqual(input, [1, 2, 3]);
    strictEqual(input.length, 3);
  });
});

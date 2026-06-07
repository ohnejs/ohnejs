import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { groupBy } from '../../../src/utils/index.ts';

const nullObj = <T extends object>(o: T): T => Object.assign(Object.create(null), o);

describe('groupBy', () => {
  it('groups by a computed key', () => {
    deepStrictEqual(
      groupBy([1, 2, 3, 4], (n) => (n % 2 === 0 ? 'even' : 'odd')),
      nullObj({ odd: [1, 3], even: [2, 4] }),
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
      nullObj({
        admin: [items[0], items[2]],
        member: [items[1]],
      }),
    );
  });

  it('preserves input order within each group', () => {
    deepStrictEqual(
      groupBy([3, 1, 4, 1, 5, 9, 2, 6], (n) => (n < 5 ? 'lo' : 'hi')),
      nullObj({ lo: [3, 1, 4, 1, 2], hi: [5, 9, 6] }),
    );
  });

  it('passes the index to keyFn', () => {
    deepStrictEqual(
      groupBy(['a', 'b', 'c', 'd'], (_, i) => (i % 2 === 0 ? 'e' : 'o')),
      nullObj({ e: ['a', 'c'], o: ['b', 'd'] }),
    );
  });

  it('supports numeric keys', () => {
    deepStrictEqual(
      groupBy([1.1, 1.9, 2.2, 2.5], (n) => Math.floor(n)),
      nullObj({ 1: [1.1, 1.9], 2: [2.2, 2.5] }),
    );
  });

  it('returns an empty object for an empty input', () => {
    deepStrictEqual(
      groupBy([], () => 'x'),
      nullObj({}),
    );
  });

  it('does not mutate the input', () => {
    const input = [1, 2, 3];
    groupBy(input, (n) => n);
    deepStrictEqual(input, [1, 2, 3]);
  });

  it('buckets correctly when keyFn returns inherited Object.prototype names', () => {
    const out = groupBy(
      ['a', 'b', 'c', 'd'],
      (_, i) => (['toString', '__proto__', 'constructor', 'hasOwnProperty'] as const)[i]!,
    );
    deepStrictEqual(
      out,
      nullObj({
        toString: ['a'],
        ['__proto__']: ['b'],
        constructor: ['c'],
        hasOwnProperty: ['d'],
      }),
    );
  });

  it('returns a null-prototype object', () => {
    strictEqual(Object.getPrototypeOf(groupBy([1], () => 'x')), null);
  });
});

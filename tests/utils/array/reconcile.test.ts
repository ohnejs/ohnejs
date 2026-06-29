import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { longestIncreasingSubsequence, type Patch, reconcile } from '../../../src/utils/index.ts';

const apply = <K>(oldKeys: readonly K[], patches: readonly Patch<K>[]): K[] => {
  const arr = [...oldKeys];
  for (const patch of patches) {
    const present = arr.indexOf(patch.key);
    if (present !== -1) arr.splice(present, 1);
    if (patch.op === 'remove') continue;
    const at = patch.before === null ? arr.length : arr.indexOf(patch.before);
    arr.splice(at, 0, patch.key);
  }
  return arr;
};

const minMoves = (oldKeys: readonly string[], newKeys: readonly string[]): number =>
  newKeys.length - longestIncreasingSubsequence(newKeys.map((key) => oldKeys.indexOf(key))).length;

describe('reconcile', () => {
  it('emits nothing for identical lists', () => {
    deepStrictEqual(reconcile(['a', 'b', 'c'], ['a', 'b', 'c']), []);
  });

  it('inserts an appended key before the end', () => {
    deepStrictEqual(reconcile(['a', 'b'], ['a', 'b', 'c']), [
      { op: 'insert', key: 'c', before: null },
    ]);
  });

  it('inserts a prepended key before its neighbour', () => {
    deepStrictEqual(reconcile(['b', 'c'], ['a', 'b', 'c']), [
      { op: 'insert', key: 'a', before: 'b' },
    ]);
  });

  it('removes an absent key', () => {
    deepStrictEqual(reconcile(['a', 'b', 'c'], ['a', 'c']), [{ op: 'remove', key: 'b' }]);
  });

  it('rotates with a single move', () => {
    deepStrictEqual(reconcile(['a', 'b', 'c'], ['b', 'c', 'a']), [
      { op: 'move', key: 'a', before: null },
    ]);
  });

  it('mixes removal and insertion', () => {
    deepStrictEqual(reconcile(['a', 'b', 'c'], ['a', 'x', 'c']), [
      { op: 'remove', key: 'b' },
      { op: 'insert', key: 'x', before: 'c' },
    ]);
  });

  it('reproduces the new list for swap, reverse, and a full scramble', () => {
    const cases: Array<[string[], string[]]> = [
      [
        ['a', 'b'],
        ['b', 'a'],
      ],
      [
        ['a', 'b', 'c'],
        ['c', 'b', 'a'],
      ],
      [
        ['a', 'b', 'c', 'd', 'e'],
        ['c', 'a', 'e', 'b', 'd'],
      ],
      [
        ['a', 'b', 'c', 'd'],
        ['d', 'x', 'b', 'y'],
      ],
    ];
    for (const [oldKeys, newKeys] of cases) {
      deepStrictEqual(apply(oldKeys, reconcile(oldKeys, newKeys)), newKeys);
    }
  });

  it('moves the minimal number of retained keys', () => {
    const permutations: Array<[string[], string[]]> = [
      [
        ['a', 'b', 'c'],
        ['b', 'c', 'a'],
      ],
      [
        ['a', 'b', 'c'],
        ['c', 'b', 'a'],
      ],
      [
        ['a', 'b', 'c', 'd', 'e'],
        ['c', 'a', 'e', 'b', 'd'],
      ],
    ];
    for (const [oldKeys, newKeys] of permutations) {
      const moves = reconcile(oldKeys, newKeys).filter((patch) => patch.op === 'move').length;
      strictEqual(moves, minMoves(oldKeys, newKeys));
    }
  });
});

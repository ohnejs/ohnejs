import { isUndefined } from '../is/is-undefined.ts';
import { longestIncreasingSubsequence } from './longest-increasing-subsequence.ts';

/**
 * A single keyed-list edit produced by `reconcile`.
 *
 * `remove` drops a key present only in the old list.
 * `insert` adds a key present only in the new list, before the key in `before` (`null` appends).
 * `move` relocates a retained key before the key in `before` (`null` appends).
 */
export type Patch<K> =
  | { readonly op: 'remove'; readonly key: K }
  | { readonly op: 'insert'; readonly key: K; readonly before: K | null }
  | { readonly op: 'move'; readonly key: K; readonly before: K | null };

/**
 * Diffs two key lists into the minimal ordered edits that turn `oldKeys` into `newKeys`.
 * Keys must be unique within each list.
 *
 * Retained keys that already sit in relative order never move.
 * The move count is therefore exactly `retained - LIS(retained)`.
 * Apply the patches in order: removals first, then insertions and moves walked right to left.
 * Each patch's `before` key is then already in place when the patch runs.
 *
 * @example
 * ```ts
 * reconcile(['a', 'b', 'c'], ['b', 'c', 'a'])
 * // -> [{ op: 'move', key: 'a', before: null }]
 *
 * reconcile(['a', 'b', 'c'], ['a', 'x', 'c'])
 * // -> [{ op: 'remove', key: 'b' }, { op: 'insert', key: 'x', before: 'c' }]
 * ```
 */
export function reconcile<K>(oldKeys: readonly K[], newKeys: readonly K[]): Patch<K>[] {
  const patches: Patch<K>[] = [];

  const oldIndex = new Map<K, number>();
  for (let i = 0; i < oldKeys.length; i++) oldIndex.set(oldKeys[i] as K, i);

  const next = new Set(newKeys);
  for (const key of oldKeys) if (!next.has(key)) patches.push({ op: 'remove', key });

  const retainedPositions: number[] = [];
  const retainedOldIndices: number[] = [];
  for (let j = 0; j < newKeys.length; j++) {
    const old = oldIndex.get(newKeys[j] as K);
    if (!isUndefined(old)) {
      retainedPositions.push(j);
      retainedOldIndices.push(old);
    }
  }

  const stable = new Set<number>();
  for (const i of longestIncreasingSubsequence(retainedOldIndices)) {
    stable.add(retainedPositions[i] as number);
  }

  for (let j = newKeys.length - 1; j >= 0; j--) {
    const key = newKeys[j] as K;
    const before = j + 1 < newKeys.length ? (newKeys[j + 1] as K) : null;
    if (!oldIndex.has(key)) patches.push({ op: 'insert', key, before });
    else if (!stable.has(j)) patches.push({ op: 'move', key, before });
  }

  return patches;
}

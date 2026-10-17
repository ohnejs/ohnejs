import type { HighlightKind } from '../highlight-token.ts';
import type { HighlightClassifier } from '../scan-tokens.ts';

/**
 * Returns the index of the capture group that matched, or `-1` for a match outside every group.
 *
 * @example
 * ```ts
 * captureGroup(/(a)|(b)/.exec('b')!) // -> 2
 * captureGroup(/(a)|b/.exec('b')!)   // -> -1
 * ```
 */
export function captureGroup(match: RegExpExecArray): number {
  return match.findIndex((group, index) => index > 0 && group !== undefined);
}

/**
 * Classifies each match by its capture group: group `n` is `kinds[n - 1]`, an ungrouped match is plain.
 *
 * @example
 * ```ts
 * const classify = classifyGroups(['comment', 'string'])
 * classify(/(#.*)|('.*')/.exec("'a'")!, "'a'") // -> 'string'
 * ```
 */
export function classifyGroups(kinds: readonly HighlightKind[]): HighlightClassifier {
  return (match) => kinds[captureGroup(match) - 1];
}

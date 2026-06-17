import { literalString } from './literal-string.ts';

/**
 * Builds a TypeScript string-literal union from `members`.
 * Each member is quoted and escaped via `literalString`; duplicates are kept as given.
 *
 * Returns `'never'` when `members` is empty, since a union of nothing is `never`.
 *
 * @example
 * ```ts
 * literalUnion(['a', 'b']) // -> "'a' | 'b'"
 * literalUnion(["it's"])   // -> "'it\\'s'"
 * literalUnion([])         // -> 'never'
 * ```
 */
export function literalUnion(members: string[]): string {
  return members.length === 0 ? 'never' : members.map(literalString).join(' | ');
}

import { quote } from './quote.ts';

/**
 * Builds a TypeScript string-literal union from `members`.
 * Each member is quoted and escaped via `quote`; duplicates are kept as given.
 *
 * Returns `'never'` when `members` is empty, since a union of nothing is `never`.
 *
 * @example
 * ```ts
 * union(['a', 'b']) // -> "'a' | 'b'"
 * union(["it's"])   // -> "'it\\'s'"
 * union([])         // -> 'never'
 * ```
 */
export function union(members: string[]): string {
  return members.length === 0 ? 'never' : members.map(quote).join(' | ');
}

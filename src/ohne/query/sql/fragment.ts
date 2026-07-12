import type { SQLValue } from '../../database/adapter.ts';

/**
 * A piece of SQL paired with the values bound to its `?` placeholders.
 * Compilers build a statement by composing fragments; the adapter receives the joined result.
 */
export interface SQLFragment {
  /**
   * The SQL text, one `?` placeholder per entry in `params`.
   */
  sql: string;

  /**
   * The bind values, in placeholder order.
   */
  params: SQLValue[];
}

/**
 * Wraps SQL text and its bind values into a fragment.
 *
 * @example
 * ```ts
 * rawFragment('"views" >= ?', [100]) // -> { sql: '"views" >= ?', params: [100] }
 * rawFragment('1 = 1')               // -> { sql: '1 = 1', params: [] }
 * ```
 */
export function rawFragment(sql: string, params: SQLValue[] = []): SQLFragment {
  return { sql, params };
}

/**
 * Joins fragments with `separator`, concatenating their SQL and their params in order.
 *
 * @example
 * ```ts
 * joinFragments([rawFragment('"a" = ?', [1]), rawFragment('"b" = ?', [2])], ' AND ')
 * // -> { sql: '"a" = ? AND "b" = ?', params: [1, 2] }
 * ```
 */
export function joinFragments(fragments: readonly SQLFragment[], separator: string): SQLFragment {
  return {
    sql: fragments.map((fragment) => fragment.sql).join(separator),
    params: fragments.flatMap((fragment) => fragment.params),
  };
}

/**
 * Builds a `column IN (?, ...)` fragment over an already-quoted column.
 * An empty list yields the match-nothing fragment `1 = 0`.
 * `in: []` means "in the empty set", which no row satisfies - never "no constraint".
 *
 * @example
 * ```ts
 * inFragment('"status"', ['draft', 'published'])
 * // -> { sql: '"status" IN (?, ?)', params: ['draft', 'published'] }
 *
 * inFragment('"status"', [])
 * // -> { sql: '1 = 0', params: [] }
 * ```
 */
export function inFragment(quotedColumn: string, params: readonly SQLValue[]): SQLFragment {
  if (params.length === 0) return rawFragment('1 = 0');
  return { sql: `${quotedColumn} IN (${params.map(() => '?').join(', ')})`, params: [...params] };
}

import type { StatementSync } from 'node:sqlite';

import { isUndefined } from '../../../../utils/index.ts';

/**
 * A per-connection cache of prepared statements, keyed by SQL text.
 */
export interface StatementCache {
  /**
   * Returns the prepared statement for `sql`, preparing and caching it on a miss.
   */
  get(sql: string): StatementSync;

  /**
   * Drops every cached statement, called when DDL may have invalidated them.
   */
  clear(): void;
}

/**
 * Builds an insertion-order LRU over prepared statements, so a repeating query prepares once.
 *
 * A hit moves its entry to the newest slot; an overflow past `cap` evicts the oldest entry.
 * The query layer's SQL is deterministic, so the read spine's repeating shapes hit the cache.
 * `prepare` is injected, so a test can count preparations without a live driver.
 *
 * @example
 * ```ts
 * const cache = createStatementCache((sql) => db.prepare(sql))
 * cache.get('SELECT 1') // -> prepares once, returns the statement on every later call
 * ```
 */
export function createStatementCache(
  prepare: (sql: string) => StatementSync,
  cap = 512,
): StatementCache {
  const cache = new Map<string, StatementSync>();
  return {
    get(sql) {
      const cached = cache.get(sql);
      if (!isUndefined(cached)) {
        cache.delete(sql);
        cache.set(sql, cached);
        return cached;
      }
      const statement = prepare(sql);
      cache.set(sql, statement);
      if (cache.size > cap) {
        const oldest = cache.keys().next().value;
        if (!isUndefined(oldest)) cache.delete(oldest);
      }
      return statement;
    },
    clear() {
      cache.clear();
    },
  };
}

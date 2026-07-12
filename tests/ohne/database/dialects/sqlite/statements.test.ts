import type { StatementSync } from 'node:sqlite';

import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { createStatementCache } from '../../../../../src/ohne/database/dialects/sqlite/statements.ts';

/**
 * A counting `prepare` seam: each call records its SQL and returns a marker standing in for a statement.
 */
function counting(): { prepare: (sql: string) => StatementSync; prepared: string[] } {
  const prepared: string[] = [];
  return {
    prepared,
    prepare(sql) {
      prepared.push(sql);
      return { sql } as unknown as StatementSync;
    },
  };
}

describe('createStatementCache', () => {
  it('prepares a given SQL once and returns the same statement thereafter', () => {
    const { prepare, prepared } = counting();
    const cache = createStatementCache(prepare);
    const first = cache.get('SELECT 1');
    const second = cache.get('SELECT 1');
    strictEqual(first, second);
    deepStrictEqual(prepared, ['SELECT 1']);
  });

  it('re-prepares after `clear`, since DDL may have invalidated the statement', () => {
    const { prepare, prepared } = counting();
    const cache = createStatementCache(prepare);
    cache.get('SELECT 1');
    cache.clear();
    cache.get('SELECT 1');
    deepStrictEqual(prepared, ['SELECT 1', 'SELECT 1']);
  });

  it('evicts the oldest entry once it grows past the cap', () => {
    const { prepare, prepared } = counting();
    const cache = createStatementCache(prepare, 2);
    cache.get('a');
    cache.get('b');
    cache.get('c'); // evicts 'a'
    cache.get('b'); // still cached
    cache.get('a'); // re-prepared
    deepStrictEqual(prepared, ['a', 'b', 'c', 'a']);
  });

  it('a hit refreshes recency, so the least-recently-used entry is the one evicted', () => {
    const { prepare, prepared } = counting();
    const cache = createStatementCache(prepare, 2);
    cache.get('a');
    cache.get('b');
    cache.get('a'); // 'a' is now the most recent, 'b' the oldest
    cache.get('c'); // evicts 'b', not 'a'
    cache.get('a'); // still cached
    cache.get('b'); // re-prepared
    deepStrictEqual(prepared, ['a', 'b', 'c', 'b']);
  });
});

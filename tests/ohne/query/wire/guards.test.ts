import { deepStrictEqual, doesNotThrow, strictEqual, throws } from 'node:assert';
import { after, before, describe, it } from 'node:test';

import { SQLiteDialect } from '../../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { clearDatabases, registerDialect } from '../../../../src/ohne/database/use-database.ts';
import {
  assertBoundParams,
  DEFAULT_QUERY_GUARDS,
  resolveGuards,
} from '../../../../src/ohne/query/wire/guards.ts';

describe('resolveGuards', () => {
  it('returns the framework defaults when nothing overrides', () => {
    deepStrictEqual(resolveGuards(), DEFAULT_QUERY_GUARDS);
  });

  it('overrides a single guard, keeping the rest at their defaults', () => {
    const resolved = resolveGuards({ maxPerPage: 5 });
    strictEqual(resolved.maxPerPage, 5);
    strictEqual(resolved.maxSelect, DEFAULT_QUERY_GUARDS.maxSelect);
  });

  it('overrides several guards at once', () => {
    const resolved = resolveGuards({ maxPerPage: 5, maxSelect: 10 });
    strictEqual(resolved.maxPerPage, 5);
    strictEqual(resolved.maxSelect, 10);
  });

  it('returns a fresh table, never mutating the defaults', () => {
    resolveGuards({ maxPerPage: 1 });
    strictEqual(DEFAULT_QUERY_GUARDS.maxPerPage, 500);
  });
});

describe('resolveGuards clamps maxBoundParams to the driver wall', () => {
  before(() => registerDialect(new SQLiteDialect()));
  after(() => clearDatabases());

  it('leaves a config value under the wall unchanged', () => {
    strictEqual(resolveGuards({ maxBoundParams: 5000 }).maxBoundParams, 5000);
  });

  it('caps a config value at the wall, never raising past it', () => {
    strictEqual(resolveGuards({ maxBoundParams: 100000 }).maxBoundParams, 32766);
  });
});

describe('assertBoundParams', () => {
  it('accepts a count at or below the limit', () => {
    doesNotThrow(() => assertBoundParams(0, 100));
    doesNotThrow(() => assertBoundParams(100, 100));
  });

  it('throws when the count exceeds the limit', () => {
    throws(() => assertBoundParams(101, 100));
  });
});

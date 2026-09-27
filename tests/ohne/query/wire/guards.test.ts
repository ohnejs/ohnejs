import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert';
import { after, before, describe, it } from 'node:test';

import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { clearDatabases, registerDialect } from '../../../../src/ohne/database/use-database.ts';
import { field } from '../../../../src/ohne/fields/field.ts';
import { HTTPError } from '../../../../src/ohne/http/http-error.ts';
import { queryMetadata } from '../../../../src/ohne/query/metadata.ts';
import { DEFAULT_QUERY_GUARDS, resolveGuards } from '../../../../src/ohne/query/wire/guards.ts';
import { parseQueryParams } from '../../../../src/ohne/query/wire/parse.ts';

useCollections().register('GPosts', {
  name: 'GPosts',
  collection: { fields: { title: field('text'), views: field('integer') } },
});

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

  it('caps an unpaged read at 2000 rows by default', () => {
    strictEqual(DEFAULT_QUERY_GUARDS.maxLimit, 2000);
  });

  it('folds a maxLimit override', () => {
    strictEqual(resolveGuards({ maxLimit: 5 }).maxLimit, 5);
  });

  it('returns a fresh table, never mutating the defaults', () => {
    resolveGuards({ maxPerPage: 1 });
    strictEqual(DEFAULT_QUERY_GUARDS.maxPerPage, 500);
  });
});

describe('resolveGuards binds a wire parse', () => {
  it('a clamp clamps, a refusal refuses', () => {
    const guards = resolveGuards({ maxPerPage: 5, maxSelect: 1 });
    const meta = queryMetadata('GPosts');
    strictEqual(parseQueryParams({ page: 1, perPage: 50 }, meta, guards).perPage, 5);
    throws(
      () => parseQueryParams({ select: ['title', 'views'] }, meta, guards),
      (error) => {
        ok(error instanceof HTTPError);
        deepStrictEqual(error.data, { code: 'tooManyFields', path: 'select' });
        return true;
      },
    );
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

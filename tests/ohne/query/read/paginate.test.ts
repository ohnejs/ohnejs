import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { DatabaseAdapter, SQLParams } from '../../../../src/ohne/database/adapter.ts';

import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { buildDesiredSchema } from '../../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../../src/ohne/database/use-database.ts';
import { field } from '../../../../src/ohne/fields/field.ts';
import { useFields } from '../../../../src/ohne/fields/use-fields.ts';
import { queryUntyped } from '../../../../src/ohne/query/query.ts';

useCollections().register('PPosts', {
  name: 'PPosts',
  collection: { fields: { title: field('text') } },
});

const dialect = new SQLiteDialect();
const db = await dialect.connect(':memory:');

// A counting proxy over the real adapter: `query` runs the row reads, `queryOne` the counts.
let rowReads = 0;
const counting: DatabaseAdapter = {
  exec: (sql) => db.exec(sql),
  run: (sql, params) => db.run(sql, params),
  query: <T>(sql: string, params?: SQLParams) => {
    rowReads += 1;
    return db.query<T>(sql, params);
  },
  queryOne: (sql, params) => db.queryOne(sql, params),
  transaction: (fn) => db.transaction(fn),
  close: () => db.close(),
};

registerDialect(dialect);
registerDatabase(counting);
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never),
});

for (let index = 1; index <= 5; index += 1) {
  await db.run('INSERT INTO "PPosts" ("UUID","_updatedAt","title") VALUES (?,?,?)', [
    `00000000-0000-7000-8000-00000000000${index}`,
    0,
    `Post ${index}`,
  ]);
}

describe('paginate', () => {
  it('reads a page with its totals', async () => {
    const page = await queryUntyped('PPosts').orderBy('title').paginate(1, 2);
    deepStrictEqual(
      page.records.map((row) => row.title),
      ['Post 1', 'Post 2'],
    );
    strictEqual(page.total, 5);
    strictEqual(page.lastPage, 3);
    strictEqual(page.page, 1);
    strictEqual(page.perPage, 2);
  });

  it('serves the last, partial page', async () => {
    const page = await queryUntyped('PPosts').orderBy('title').paginate(3, 2);
    deepStrictEqual(
      page.records.map((row) => row.title),
      ['Post 5'],
    );
    strictEqual(page.lastPage, 3);
  });

  it('short-circuits a page past the last one, issuing no row read', async () => {
    const before = rowReads;
    const page = await queryUntyped('PPosts').paginate(4, 2);
    deepStrictEqual(page.records, []);
    strictEqual(page.total, 5);
    strictEqual(page.lastPage, 3);
    strictEqual(rowReads, before);
  });

  it('reads page one even when the match is empty', async () => {
    const before = rowReads;
    const page = await queryUntyped('PPosts').where({ title: 'Nope' }).paginate(1, 2);
    deepStrictEqual(page.records, []);
    strictEqual(page.total, 0);
    strictEqual(page.lastPage, 1);
    strictEqual(rowReads, before + 1);
  });
});

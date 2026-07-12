import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { buildDesiredSchema } from '../../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../../src/ohne/database/use-database.ts';
import { field } from '../../../../src/ohne/fields/field.ts';
import { useFields } from '../../../../src/ohne/fields/use-fields.ts';
import { queryUntyped } from '../../../../src/ohne/query/query.ts';

useCollections().register('CPosts', {
  name: 'CPosts',
  collection: { fields: { title: field('text'), views: field('integer') } },
});

const dialect = new SQLiteDialect();
const db = await dialect.connect(':memory:');
registerDialect(dialect);
registerDatabase(db);
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never),
});

let counter = 0;
async function insert(title: string, views: number): Promise<void> {
  counter += 1;
  await db.run('INSERT INTO "CPosts" ("UUID","_updatedAt","title","views") VALUES (?,?,?,?)', [
    `00000000-0000-7000-8000-00000000000${counter}`,
    0,
    title,
    views,
  ]);
}
await insert('Alpha', 100);
await insert('Beta', 50);
await insert('Gamma', 100);

describe('count', () => {
  it('counts the matching rows', async () => {
    strictEqual(await queryUntyped('CPosts').count(), 3);
    strictEqual(await queryUntyped('CPosts').where({ views: 100 }).count(), 2);
  });

  it('ignores the row window, since a count spans the whole match', async () => {
    strictEqual(await queryUntyped('CPosts').limit(1).offset(1).count(), 3);
  });
});

describe('exists', () => {
  it('reports whether any row matches', async () => {
    strictEqual(await queryUntyped('CPosts').where({ title: 'Beta' }).exists(), true);
    strictEqual(await queryUntyped('CPosts').where({ title: 'Nope' }).exists(), false);
  });
});

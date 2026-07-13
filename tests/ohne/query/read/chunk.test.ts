import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { buildDesiredSchema } from '../../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../../src/ohne/database/use-database.ts';
import { field } from '../../../../src/ohne/fields/field.ts';
import { useFields } from '../../../../src/ohne/fields/use-fields.ts';
import { queryUntyped } from '../../../../src/ohne/query/query.ts';

useCollections().register('CTags', {
  name: 'CTags',
  collection: { fields: { label: field('text') } },
});
useCollections().register('CPosts', {
  name: 'CPosts',
  collection: {
    fields: { title: field('text'), tags: field('records', { collection: 'CTags' }) },
  },
});

const dialect = new SQLiteDialect();
const db = await dialect.connect(':memory:');
registerDialect(dialect);
registerDatabase(db);
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never),
});

const COUNT = 1200;
const id = (kind: string, n: number): string =>
  `00000000-0000-7000-8000-${kind}${n.toString().padStart(11, '0')}`;

await db.transaction(async (tx) => {
  for (let n = 1; n <= COUNT; n += 1) {
    await tx.run('INSERT INTO "CTags" ("UUID","_updatedAt","label") VALUES (?,?,?)', [
      id('b', n),
      0,
      `tag ${n}`,
    ]);
    await tx.run('INSERT INTO "CPosts" ("UUID","_updatedAt","title") VALUES (?,?,?)', [
      id('c', n),
      0,
      `post ${n.toString().padStart(4, '0')}`,
    ]);
    await tx.run(
      'INSERT INTO "CPosts_tags" ("_parentUUID","_targetUUID","_parentPosition","_targetPosition") VALUES (?,?,?,?)',
      [id('c', n), id('b', n), 0, 0],
    );
  }
});

describe('chunked hydration past 900 parents', () => {
  it('hydrates every parent`s relation across chunk boundaries', async () => {
    const rows = await queryUntyped('CPosts').orderBy('title').findMany();
    strictEqual(rows.length, COUNT);
    strictEqual(
      rows.every((row) => (row.tags as string[]).length === 1),
      true,
    );
    deepStrictEqual(rows[0]?.tags, [id('b', 1)]);
    deepStrictEqual(rows[COUNT - 1]?.tags, [id('b', COUNT)]);
  });

  it('populates every distinct target across chunk boundaries', async () => {
    const rows = await queryUntyped('CPosts').orderBy('title').populate('tags').findMany();
    strictEqual(rows.length, COUNT);
    const firstTags = (rows[0] as Record<string, unknown>).tags as Record<string, unknown>[];
    deepStrictEqual(firstTags[0], { UUID: id('b', 1), _updatedAt: 0, label: 'tag 1' });
    const lastTags = (rows[COUNT - 1] as Record<string, unknown>).tags as Record<string, unknown>[];
    deepStrictEqual((lastTags[0] as Record<string, unknown>).label, `tag ${COUNT}`);
  });
});

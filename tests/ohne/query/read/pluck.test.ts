import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { buildDesiredSchema } from '../../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../../src/ohne/database/use-database.ts';
import { field } from '../../../../src/ohne/fields/field.ts';
import { useFields } from '../../../../src/ohne/fields/use-fields.ts';
import { queryUntyped } from '../../../../src/ohne/query/query.ts';

useCollections().register('KAuthors', {
  name: 'KAuthors',
  collection: { fields: { name: field('text') } },
});
useCollections().register('KTags', {
  name: 'KTags',
  collection: { fields: { label: field('text') } },
});
useCollections().register('KPosts', {
  name: 'KPosts',
  collection: {
    fields: {
      title: field('text'),
      views: field('integer'),
      author: field('record', { collection: 'KAuthors' }),
      tags: field('records', { collection: 'KTags' }),
    },
  },
});

const dialect = new SQLiteDialect();
const db = await dialect.connect(':memory:');
registerDialect(dialect);
registerDatabase(db);
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never),
});

const id = (kind: string, n: number): string =>
  `00000000-0000-7000-8000-${kind}${n.toString().padStart(11, '0')}`;

await db.run('INSERT INTO "KAuthors" ("UUID","_updatedAt","name") VALUES (?,?,?)', [
  id('a', 1),
  0,
  'Ada',
]);
await db.run('INSERT INTO "KTags" ("UUID","_updatedAt","label") VALUES (?,?,?)', [
  id('b', 1),
  0,
  'x',
]);
await db.run('INSERT INTO "KTags" ("UUID","_updatedAt","label") VALUES (?,?,?)', [
  id('b', 2),
  0,
  'y',
]);

async function post(
  n: number,
  title: string,
  views: number,
  authorUUID: string | null,
): Promise<void> {
  await db.run(
    'INSERT INTO "KPosts" ("UUID","_updatedAt","title","views","author") VALUES (?,?,?,?,?)',
    [id('c', n), 0, title, views, authorUUID],
  );
}
await post(1, 'Alpha', 100, id('a', 1));
await post(2, 'Beta', 50, null);
await db.run(
  'INSERT INTO "KPosts_tags" ("_parentUUID","_targetUUID","_parentPosition","_targetPosition") VALUES (?,?,?,?)',
  [id('c', 1), id('b', 1), 0, 0],
);
await db.run(
  'INSERT INTO "KPosts_tags" ("_parentUUID","_targetUUID","_parentPosition","_targetPosition") VALUES (?,?,?,?)',
  [id('c', 1), id('b', 2), 1, 0],
);

describe('pluck', () => {
  it('fast-paths a plain column through the codec', async () => {
    deepStrictEqual(await queryUntyped('KPosts').orderBy('title').pluck('title'), [
      'Alpha',
      'Beta',
    ]);
    deepStrictEqual(await queryUntyped('KPosts').orderBy('title').pluck('views'), [100, 50]);
  });

  it('respects the where, order, and window of the query', async () => {
    deepStrictEqual(
      await queryUntyped('KPosts')
        .where({ views: { atLeast: 100 } })
        .pluck('title'),
      ['Alpha'],
    );
    deepStrictEqual(await queryUntyped('KPosts').orderBy('views', 'desc').limit(1).pluck('title'), [
      'Alpha',
    ]);
  });

  it('fast-paths an unpopulated record foreign key to its raw UUID', async () => {
    deepStrictEqual(await queryUntyped('KPosts').orderBy('title').pluck('author'), [
      id('a', 1),
      null,
    ]);
  });

  it('falls back to the loader path for a column-less relation', async () => {
    deepStrictEqual(await queryUntyped('KPosts').orderBy('title').pluck('tags'), [
      [id('b', 1), id('b', 2)],
      [],
    ]);
  });

  it('populates a plucked relation through the loader path', async () => {
    deepStrictEqual(
      await queryUntyped('KPosts').where({ title: 'Alpha' }).populate('author').pluck('author'),
      [{ UUID: id('a', 1), _updatedAt: 0, name: 'Ada' }],
    );
  });
});

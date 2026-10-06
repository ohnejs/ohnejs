import { deepStrictEqual, ok, rejects, strictEqual, throws } from 'node:assert';
import { afterEach, describe, it } from 'node:test';

import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { buildDesiredSchema } from '../../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../../src/ohne/database/use-database.ts';
import { field } from '../../../../src/ohne/fields/field.ts';
import { useFields } from '../../../../src/ohne/fields/use-fields.ts';
import { hook } from '../../../../src/ohne/hooks/hook.ts';
import { useHooks } from '../../../../src/ohne/hooks/use-hooks.ts';
import { queryUntyped } from '../../../../src/ohne/query/query.ts';
import { runCreate } from '../../../../src/ohne/query/write/create.ts';
import { runDelete } from '../../../../src/ohne/query/write/delete.ts';
import { isReferenceViolation } from '../../../../src/ohne/query/write/errors.ts';
import { linksField } from './_links-field.ts';

useCollections().register('DAuthor', {
  name: 'DAuthor',
  collection: { fields: { name: field('text') } },
});
useCollections().register('DTag', {
  name: 'DTag',
  collection: { fields: { label: field('text') } },
});
useCollections().register('DPost', {
  name: 'DPost',
  collection: {
    fields: {
      title: field('text'),
      author: field('record', { collection: 'DAuthor', onDelete: 'restrict' }),
      tags: field('records', { collection: 'DTag' }),
      sections: field('repeater', { fields: { heading: field('text') } }),
    },
  },
});
useCollections().register('DLinked', {
  name: 'DLinked',
  collection: {
    fields: { links: linksField(), rows: field('repeater', { fields: { links: linksField() } }) },
  },
});

const dialect = new SQLiteDialect();
const db = await dialect.connect(':memory:');
registerDialect(dialect);
registerDatabase(db);
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never),
});
await db.run('INSERT INTO "DAuthor" ("UUID","_updatedAt","name") VALUES (?,?,?)', [
  'a1',
  1,
  'Anduin',
]);
await db.run('INSERT INTO "DTag" ("UUID","_updatedAt","label") VALUES (?,?,?)', ['t1', 1, 'A']);

let counter = 0;

/**
 * Creates a fresh post and returns its `UUID`.
 */
async function seedPost(over: Record<string, unknown> = {}): Promise<string> {
  const result = await runCreate(
    'DPost',
    {
      title: `P${counter++}`,
      author: 'a1',
      tags: ['t1'],
      sections: [{ heading: 'a' }],
      ...over,
    },
    null,
  );
  ok(result.ok);
  return (result.record as { UUID: string }).UUID;
}

/**
 * Counts the rows in `table` whose `column` equals `value`.
 */
async function countWhere(table: string, column: string, value: string): Promise<number> {
  const rows = await db.query(`SELECT 1 FROM "${table}" WHERE "${column}" = ?`, [value]);
  return rows.length;
}

describe('runDelete', () => {
  it('deletes every matching record and reports the count', async () => {
    const a = await seedPost({ title: 'DEL' });
    const b = await seedPost({ title: 'DEL' });
    const result = await runDelete('DPost', {
      kind: 'compare',
      path: ['title'],
      op: 'equalsTo',
      value: 'DEL',
      negated: false,
    });
    strictEqual(result.deleted, 2);
    strictEqual(await countWhere('DPost', 'UUID', a), 0);
    strictEqual(await countWhere('DPost', 'UUID', b), 0);
  });

  it('leaves non-matching records untouched', async () => {
    const kept = await seedPost();
    const gone = await seedPost({ title: 'ONLY-ME' });
    const result = await runDelete('DPost', {
      kind: 'compare',
      path: ['title'],
      op: 'equalsTo',
      value: 'ONLY-ME',
      negated: false,
    });
    strictEqual(result.deleted, 1);
    strictEqual(await countWhere('DPost', 'UUID', kept), 1);
    strictEqual(await countWhere('DPost', 'UUID', gone), 0);
  });

  it('cascades child and junction rows', async () => {
    const post = await seedPost();
    strictEqual(await countWhere('DPost_sections', '_parentUUID', post), 1);
    strictEqual(await countWhere('DPost_tags', '_parentUUID', post), 1);
    await runDelete('DPost', uuidIs(post));
    strictEqual(await countWhere('DPost_sections', '_parentUUID', post), 0);
    strictEqual(await countWhere('DPost_tags', '_parentUUID', post), 0);
  });

  it('throws a referenceViolation when a restrict reference blocks it', async () => {
    await db.run('INSERT INTO "DAuthor" ("UUID","_updatedAt","name") VALUES (?,?,?)', [
      'a2',
      1,
      'Liadrin',
    ]);
    await seedPost({ author: 'a2' });
    await rejects(() => runDelete('DAuthor', uuidIs('a2')), isReferenceViolation);
    strictEqual(await countWhere('DAuthor', 'UUID', 'a2'), 1);
  });

  it('throws without a filter through the untyped builder', () => {
    throws(() => queryUntyped('DPost').delete(), /without a filter/);
  });

  it('deletes a link target without cascading or blocking', async () => {
    const target = '01900000-0000-7000-8000-00000000000a';
    await db.run('INSERT INTO "DAuthor" ("UUID","_updatedAt","name") VALUES (?,?,?)', [
      target,
      1,
      'Jaina',
    ]);
    const link = { collection: 'DAuthor', record: target };
    const created = await runCreate('DLinked', { links: [link], rows: [{ links: [link] }] }, null);
    ok(created.ok);
    strictEqual((await runDelete('DAuthor', uuidIs(target))).deleted, 1);
    const record = await queryUntyped('DLinked').where({ UUID: created.record.UUID }).findFirst();
    ok(record);
    deepStrictEqual(record.links, [link]);
    deepStrictEqual((record.rows as { links: unknown }[])[0].links, [link]);
  });
});

describe('runDelete hooks', () => {
  afterEach(() => useHooks().clear());

  it('sees the matched rows still present in `record:before-delete`', async () => {
    const post = await seedPost();
    let captured: readonly string[] = [];
    let stillThere = 0;
    hook('record:before-delete', async (ctx) => {
      captured = ctx.matched;
      const rows = await ctx.tx.query('SELECT "UUID" FROM "DPost" WHERE "UUID" = ?', [post]);
      stillThere = rows.length;
    });
    const result = await runDelete('DPost', uuidIs(post));
    strictEqual(result.deleted, 1);
    deepStrictEqual(captured, [post]);
    strictEqual(stillThere, 1);
    strictEqual(await countWhere('DPost', 'UUID', post), 0);
  });

  it('deletes through the fast path with no subscriber', async () => {
    const post = await seedPost();
    const result = await runDelete('DPost', uuidIs(post));
    strictEqual(result.deleted, 1);
    strictEqual(await countWhere('DPost', 'UUID', post), 0);
  });
});

/**
 * The condition matching one record by `UUID`.
 */
function uuidIs(uuid: string) {
  return { kind: 'compare', path: ['UUID'], op: 'equalsTo', value: uuid, negated: false } as const;
}

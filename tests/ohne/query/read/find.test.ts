import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { afterEach, describe, it } from 'node:test';

import type { FieldInstance } from '../../../../src/ohne/fields/field.ts';
import type { FieldTypeName } from '../../../../src/ohne/fields/known-fields.ts';

import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { buildDesiredSchema } from '../../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../../src/ohne/database/use-database.ts';
import { defineField } from '../../../../src/ohne/fields/define-field.ts';
import { field } from '../../../../src/ohne/fields/field.ts';
import { useFields } from '../../../../src/ohne/fields/use-fields.ts';
import { hook } from '../../../../src/ohne/hooks/hook.ts';
import { useHooks } from '../../../../src/ohne/hooks/use-hooks.ts';
import { queryUntyped } from '../../../../src/ohne/query/query.ts';

useFields().register('jsonBag', {
  name: 'jsonBag' as FieldTypeName,
  fieldType: defineField({ columnType: 'json' }),
});
const jsonInstance = { type: 'jsonBag', options: {} } as unknown as FieldInstance;

useCollections().register('FPosts', {
  name: 'FPosts',
  collection: {
    fields: {
      title: field('text'),
      views: field('integer'),
      featured: field('boolean'),
      summary: field('text', { nullable: true }),
      data: jsonInstance,
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

const ID = {
  alpha: '00000000-0000-7000-8000-000000000001',
  beta: '00000000-0000-7000-8000-000000000002',
  gamma: '00000000-0000-7000-8000-000000000003',
};

async function insert(
  uuid: string,
  title: string,
  views: number,
  featured: boolean,
  summary: string | null,
  data: unknown,
): Promise<void> {
  await db.run(
    'INSERT INTO "FPosts" ("UUID","_updatedAt","title","views","featured","summary","data") ' +
      'VALUES (?,?,?,?,?,?,?)',
    [uuid, 0, title, views, featured ? 1 : 0, summary, JSON.stringify(data)],
  );
}

await insert(ID.alpha, 'Alpha', 100, true, 'first', { a: 1 });
await insert(ID.beta, 'Beta', 50, false, null, [1, 2]);
await insert(ID.gamma, 'Gamma', 100, true, 'third', { nested: { x: true } });

async function titles(builder: ReturnType<typeof queryUntyped>): Promise<string[]> {
  return (await builder.findMany()).map((row) => row.title as string);
}

describe('findMany', () => {
  it('returns the complete record, values through the codec', async () => {
    const first = await queryUntyped('FPosts').where({ title: 'Alpha' }).findFirst();
    deepStrictEqual(first, {
      UUID: ID.alpha,
      _updatedAt: 0,
      title: 'Alpha',
      views: 100,
      featured: true,
      summary: 'first',
      data: { a: 1 },
    });
  });

  it('round-trips boolean and json values symmetrically', async () => {
    const beta = await queryUntyped('FPosts').where({ title: 'Beta' }).findFirst();
    strictEqual(beta?.featured, false);
    strictEqual(beta?.summary, null);
    deepStrictEqual(beta?.data, [1, 2]);
    const gamma = await queryUntyped('FPosts').where({ title: 'Gamma' }).findFirst();
    deepStrictEqual(gamma?.data, { nested: { x: true } });
  });

  it('filters by equality, in, and ordering', async () => {
    deepStrictEqual(
      await titles(queryUntyped('FPosts').where({ featured: true }).orderBy('title')),
      ['Alpha', 'Gamma'],
    );
    deepStrictEqual(await titles(queryUntyped('FPosts').where({ views: { in: [50] } })), ['Beta']);
    deepStrictEqual(
      await titles(
        queryUntyped('FPosts')
          .where({ views: { greaterThan: 50 } })
          .orderBy('title'),
      ),
      ['Alpha', 'Gamma'],
    );
  });

  it('matches the text trio case-insensitively', async () => {
    deepStrictEqual(await titles(queryUntyped('FPosts').where({ title: { contains: 'AMM' } })), [
      'Gamma',
    ]);
    deepStrictEqual(await titles(queryUntyped('FPosts').where({ title: { startsWith: 'be' } })), [
      'Beta',
    ]);
  });

  it('tests null on a nullable column', async () => {
    deepStrictEqual(await titles(queryUntyped('FPosts').where({ summary: { isNull: true } })), [
      'Beta',
    ]);
    deepStrictEqual(
      await titles(
        queryUntyped('FPosts')
          .where({ summary: { not: { isNull: true } } })
          .orderBy('title'),
      ),
      ['Alpha', 'Gamma'],
    );
  });

  it('negates and disjoins within a field', async () => {
    deepStrictEqual(
      await titles(queryUntyped('FPosts').where({ views: { not: { equalsTo: 100 } } })),
      ['Beta'],
    );
    deepStrictEqual(
      await titles(
        queryUntyped('FPosts')
          .where({ views: { atLeast: 100, or: [{ equalsTo: 50 }] } })
          .orderBy('title'),
      ),
      ['Alpha', 'Beta', 'Gamma'],
    );
  });

  it('appends the UUID tiebreaker, so equal sort keys keep a stable order', async () => {
    deepStrictEqual(await titles(queryUntyped('FPosts').orderBy('views', 'desc')), [
      'Alpha',
      'Gamma',
      'Beta',
    ]);
  });

  it('caps and offsets the row window', async () => {
    deepStrictEqual(await titles(queryUntyped('FPosts').limit(0)), []);
    deepStrictEqual(await titles(queryUntyped('FPosts').orderBy('title').limit(2)), [
      'Alpha',
      'Beta',
    ]);
    deepStrictEqual(await titles(queryUntyped('FPosts').orderBy('title').offset(1)), [
      'Beta',
      'Gamma',
    ]);
  });

  it('narrows to selected fields, dropping the unselected UUID', async () => {
    const rows = await queryUntyped('FPosts').select('title', 'views').orderBy('title').findMany();
    deepStrictEqual(rows, [
      { title: 'Alpha', views: 100 },
      { title: 'Beta', views: 50 },
      { title: 'Gamma', views: 100 },
    ]);
  });
});

describe('query:records', () => {
  afterEach(() => useHooks().clear());

  it('transforms every row of a record read, leaving the count untouched', async () => {
    hook('query:records', (records) => records.map((record) => ({ ...record, computed: true })));
    const rows = await queryUntyped('FPosts').findMany();
    strictEqual(rows.length, 3);
    ok(rows.every((row) => row.computed === true));
  });

  it('does not fire for a count', async () => {
    let fired = 0;
    hook('query:records', (records) => {
      fired += 1;
      return records;
    });
    await queryUntyped('FPosts').count();
    strictEqual(fired, 0);
  });
});

describe('query:complete', () => {
  afterEach(() => useHooks().clear());

  it('reports the collection, row count, and a non-negative duration', async () => {
    const seen: { collection: string; rowCount: number; durationMs: number }[] = [];
    hook('query:complete', (info) => {
      seen.push(info);
    });
    await queryUntyped('FPosts').where({ featured: true }).findMany();
    strictEqual(seen.length, 1);
    strictEqual(seen[0]?.collection, 'FPosts');
    strictEqual(seen[0]?.rowCount, 2);
    strictEqual(typeof seen[0]?.durationMs, 'number');
    ok(seen[0]!.durationMs >= 0);
  });

  it('does not fire for a count', async () => {
    let fired = 0;
    hook('query:complete', () => {
      fired += 1;
    });
    await queryUntyped('FPosts').count();
    strictEqual(fired, 0);
  });
});

describe('findFirst', () => {
  it('returns the first row in order', async () => {
    const row = await queryUntyped('FPosts').orderBy('views', 'desc').findFirst();
    strictEqual(row?.title, 'Alpha');
  });

  it('returns undefined when nothing matches', async () => {
    strictEqual(await queryUntyped('FPosts').where({ title: 'Nope' }).findFirst(), undefined);
  });
});

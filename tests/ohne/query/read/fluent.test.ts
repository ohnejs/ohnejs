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

useCollections().register('FAuthors', {
  name: 'FAuthors',
  collection: { fields: { name: field('text') } },
});
useCollections().register('FTags', {
  name: 'FTags',
  collection: { fields: { label: field('text') } },
});
useCollections().register('FPosts', {
  name: 'FPosts',
  collection: {
    fields: {
      title: field('text'),
      views: field('integer'),
      author: field('record', { collection: 'FAuthors' }),
      tags: field('records', { collection: 'FTags' }),
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

async function author(uuid: string, name: string): Promise<void> {
  await db.run('INSERT INTO "FAuthors" ("UUID","_updatedAt","name") VALUES (?,?,?)', [
    uuid,
    0,
    name,
  ]);
}
async function tag(uuid: string, label: string): Promise<void> {
  await db.run('INSERT INTO "FTags" ("UUID","_updatedAt","label") VALUES (?,?,?)', [
    uuid,
    0,
    label,
  ]);
}
async function post(uuid: string, title: string, views: number, a: string | null): Promise<void> {
  await db.run(
    'INSERT INTO "FPosts" ("UUID","_updatedAt","title","views","author") VALUES (?,?,?,?,?)',
    [uuid, 0, title, views, a],
  );
}
async function link(p: string, t: string): Promise<void> {
  await db.run(
    'INSERT INTO "FPosts_tags" ("_parentUUID","_targetUUID","_parentPosition","_targetPosition") VALUES (?,?,?,?)',
    [p, t, 0, 0],
  );
}

const A = (n: number): string => id('a', n);
const T = (n: number): string => id('b', n);
const P = (n: number): string => id('c', n);

await author(A(1), 'Ada');
await author(A(2), 'Alan');
await tag(T(1), 'red');
await post(P(1), 'First', 100, A(1));
await post(P(2), 'Second', 50, null);
await post(P(3), 'Third', 100, A(2));
await post(P(4), 'Fourth', 20, A(1));
await link(P(1), T(1));
await link(P(3), T(1));

/**
 * A loose view of the fluent builder, so a test can drive `.where(field, value | build)` at runtime.
 */
interface Ops {
  equalsTo(value: unknown): Ops;
  in(values: unknown): Ops;
  greaterThan(value: unknown): Ops;
  atLeast(value: unknown): Ops;
  lessThan(value: unknown): Ops;
  atMost(value: unknown): Ops;
  contains(value: unknown): Ops;
  startsWith(value: unknown): Ops;
  endsWith(value: unknown): Ops;
  like(value: unknown): Ops;
  isNull(): Ops;
  has(build?: (q: Sub) => Sub): Ops;
  empty(): Ops;
  readonly not: Ops;
  readonly or: Ops;
}
interface Sub {
  where(field: string, value: unknown): Sub;
  whereAny(build: (group: Sub) => Sub[]): Sub;
}
interface Fluent {
  where(field: string, build: (w: Ops) => Ops): Fluent;
  where(field: string, value: unknown): Fluent;
  whereAny(build: (group: Sub) => Sub[]): Fluent;
  orderBy(field: string, direction?: 'asc' | 'desc'): Fluent;
  findMany(): Promise<Record<string, unknown>[]>;
}

const posts = (): Fluent => queryUntyped('FPosts') as unknown as Fluent;

async function titles(builder: Fluent): Promise<string[]> {
  return (await builder.orderBy('title').findMany()).map((row) => row.title as string);
}

describe('fluent where lowers to the object grammar', () => {
  it('equality shorthand filters by value', async () => {
    deepStrictEqual(await titles(posts().where('title', 'First')), ['First']);
  });

  it('an operator callback filters by comparison', async () => {
    deepStrictEqual(await titles(posts().where('views', (w) => w.atLeast(100))), [
      'First',
      'Third',
    ]);
  });

  it('a text operator matches substrings', async () => {
    deepStrictEqual(await titles(posts().where('title', (w) => w.contains('ir'))), [
      'First',
      'Third',
    ]);
  });

  it('the not namespace negates the operator', async () => {
    deepStrictEqual(await titles(posts().where('views', (w) => w.not.equalsTo(100))), [
      'Fourth',
      'Second',
    ]);
  });

  it('or folds a disjunction into the comparison', async () => {
    deepStrictEqual(await titles(posts().where('views', (w) => w.atLeast(100).or.equalsTo(20))), [
      'First',
      'Fourth',
      'Third',
    ]);
  });

  it('chained where clauses AND', async () => {
    deepStrictEqual(
      await titles(
        posts()
          .where('views', (w) => w.atLeast(100))
          .where('author', (w) => w.has()),
      ),
      ['First', 'Third'],
    );
  });
});

describe('fluent has re-scopes to the relation target', () => {
  it('a conditioned has probes the target row', async () => {
    deepStrictEqual(
      await titles(posts().where('author', (w) => w.has((q) => q.where('name', 'Ada')))),
      ['First', 'Fourth'],
    );
  });

  it('a bare has tests the foreign key', async () => {
    deepStrictEqual(await titles(posts().where('author', (w) => w.has())), [
      'First',
      'Fourth',
      'Third',
    ]);
  });

  it('empty on a records relation keeps the untagged', async () => {
    deepStrictEqual(await titles(posts().where('tags', (w) => w.empty())), ['Fourth', 'Second']);
  });

  it('whereAny inside a has ORs the target conditions', async () => {
    deepStrictEqual(
      await titles(
        posts().where('author', (w) =>
          w.has((q) => q.whereAny((g) => [g.where('name', 'Ada'), g.where('name', 'Alan')])),
        ),
      ),
      ['First', 'Fourth', 'Third'],
    );
  });
});

describe('fluent whereAny ORs its branches', () => {
  it('ORs branch conditions', async () => {
    deepStrictEqual(
      await titles(posts().whereAny((g) => [g.where('title', 'First'), g.where('title', 'Third')])),
      ['First', 'Third'],
    );
  });

  it('ANDs the conditions chained onto one branch', async () => {
    deepStrictEqual(
      await titles(posts().whereAny((g) => [g.where('views', 100).where('title', 'First')])),
      ['First'],
    );
  });
});

describe('every operator lowers through the fluent form', () => {
  it('equalsTo in a callback', async () => {
    deepStrictEqual(await titles(posts().where('views', (w) => w.equalsTo(100))), [
      'First',
      'Third',
    ]);
  });

  it('in', async () => {
    deepStrictEqual(await titles(posts().where('views', (w) => w.in([100, 20]))), [
      'First',
      'Fourth',
      'Third',
    ]);
  });

  it('greaterThan', async () => {
    deepStrictEqual(await titles(posts().where('views', (w) => w.greaterThan(50))), [
      'First',
      'Third',
    ]);
  });

  it('lessThan', async () => {
    deepStrictEqual(await titles(posts().where('views', (w) => w.lessThan(50))), ['Fourth']);
  });

  it('atMost', async () => {
    deepStrictEqual(await titles(posts().where('views', (w) => w.atMost(50))), [
      'Fourth',
      'Second',
    ]);
  });

  it('startsWith', async () => {
    deepStrictEqual(await titles(posts().where('title', (w) => w.startsWith('F'))), [
      'First',
      'Fourth',
    ]);
  });

  it('endsWith', async () => {
    deepStrictEqual(await titles(posts().where('title', (w) => w.endsWith('d'))), [
      'Second',
      'Third',
    ]);
  });

  it('like', async () => {
    deepStrictEqual(await titles(posts().where('title', (w) => w.like('F%'))), ['First', 'Fourth']);
  });

  it('isNull on a nullable relation', async () => {
    deepStrictEqual(await titles(posts().where('author', (w) => w.isNull())), ['Second']);
  });
});

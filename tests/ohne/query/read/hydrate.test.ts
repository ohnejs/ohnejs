import { deepStrictEqual, ok, strictEqual } from 'node:assert';
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

useCollections().register('HAuthors', {
  name: 'HAuthors',
  collection: { fields: { name: field('text') } },
});
useCollections().register('HTags', {
  name: 'HTags',
  collection: {
    fields: {
      label: field('text'),
      posts: field('records', { collection: 'HPosts', inverse: 'tags' }),
    },
  },
});
useCollections().register('HPosts', {
  name: 'HPosts',
  collection: {
    fields: {
      title: field('text'),
      author: field('record', { collection: 'HAuthors' }),
      tags: field('records', { collection: 'HTags' }),
      meta: field('object', {
        fields: { note: field('text'), links: field('records', { collection: 'HTags' }) },
      }),
      sections: field('repeater', {
        fields: {
          heading: field('text'),
          items: field('repeater', { fields: { label: field('text') } }),
        },
      }),
    },
  },
});

const dialect = new SQLiteDialect();
const db = await dialect.connect(':memory:');

let queries = 0;
const counting: DatabaseAdapter = {
  exec: (sql) => db.exec(sql),
  run: (sql, params) => db.run(sql, params),
  query: <T>(sql: string, params?: SQLParams) => {
    queries += 1;
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

const TS = 111;
const id = (kind: string, n: number): string =>
  `00000000-0000-7000-8000-${kind}${n.toString().padStart(11, '0')}`;
const A = (n: number): string => id('a', n);
const T = (n: number): string => id('b', n);
const P = (n: number): string => id('c', n);
const M = (n: number): string => id('d', n);
const S = (n: number): string => id('e', n);
const I = (n: number): string => id('f', n);

async function author(uuid: string, name: string): Promise<void> {
  await db.run('INSERT INTO "HAuthors" ("UUID","_updatedAt","name") VALUES (?,?,?)', [
    uuid,
    TS,
    name,
  ]);
}
async function tag(uuid: string, label: string): Promise<void> {
  await db.run('INSERT INTO "HTags" ("UUID","_updatedAt","label") VALUES (?,?,?)', [
    uuid,
    TS,
    label,
  ]);
}
async function post(uuid: string, title: string, authorUUID: string | null): Promise<void> {
  await db.run('INSERT INTO "HPosts" ("UUID","_updatedAt","title","author") VALUES (?,?,?,?)', [
    uuid,
    TS,
    title,
    authorUUID,
  ]);
}
async function linkTag(p: string, t: string, pPos: number, tPos: number): Promise<void> {
  await db.run(
    'INSERT INTO "HPosts_tags" ("_parentUUID","_targetUUID","_parentPosition","_targetPosition") VALUES (?,?,?,?)',
    [p, t, pPos, tPos],
  );
}
async function meta(uuid: string, parent: string, note: string): Promise<void> {
  await db.run('INSERT INTO "HPosts_meta" ("UUID","_parentUUID","note") VALUES (?,?,?)', [
    uuid,
    parent,
    note,
  ]);
}
async function linkMetaTag(m: string, t: string, pPos: number, tPos: number): Promise<void> {
  await db.run(
    'INSERT INTO "HPosts_meta_links" ("_parentUUID","_targetUUID","_parentPosition","_targetPosition") VALUES (?,?,?,?)',
    [m, t, pPos, tPos],
  );
}
async function section(uuid: string, parent: string, pos: number, heading: string): Promise<void> {
  await db.run(
    'INSERT INTO "HPosts_sections" ("UUID","_parentUUID","_parentPosition","heading") VALUES (?,?,?,?)',
    [uuid, parent, pos, heading],
  );
}
async function item(uuid: string, parent: string, pos: number, label: string): Promise<void> {
  await db.run(
    'INSERT INTO "HPosts_sections_items" ("UUID","_parentUUID","_parentPosition","label") VALUES (?,?,?,?)',
    [uuid, parent, pos, label],
  );
}

await author(A(1), 'Ada');
await author(A(2), 'Alan');
await tag(T(1), 'red');
await tag(T(2), 'green');
await tag(T(3), 'blue');

await post(P(1), 'First', A(1));
await post(P(2), 'Second', null);
await post(P(3), 'Third', A(2));
await post(P(4), 'Fourth', A(1));

// Parent and target positions deliberately diverge, so each side's read must use its own column.
// Owner P1.tags by parent position is [green, red]; inverse red.posts by target position is [P1, P3].
// Ordering either side by the other side's column would flip both results.
await linkTag(P(1), T(2), 0, 1);
await linkTag(P(1), T(1), 1, 0);
await linkTag(P(3), T(1), 0, 1);

await meta(M(1), P(1), 'm1');
await linkMetaTag(M(1), T(3), 0, 0);
await meta(M(3), P(3), 'm3');

await section(S(1), P(1), 0, 'S1');
await section(S(2), P(1), 1, 'S2');
await item(I(1), S(1), 0, 'i1');
await item(I(2), S(1), 1, 'i2');
await section(S(3), P(3), 0, 'S3');
await item(I(3), S(3), 0, 'i3');

const first = (): ReturnType<typeof queryUntyped> =>
  queryUntyped('HPosts').where({ title: 'First' });

describe('full-record hydration', () => {
  it('assembles the complete shape: relations as UUIDs, composites nested, item UUIDs exposed', async () => {
    const record = await first().findFirst();
    deepStrictEqual(record, {
      UUID: P(1),
      _updatedAt: TS,
      title: 'First',
      author: A(1),
      tags: [T(2), T(1)],
      meta: { UUID: M(1), note: 'm1', links: [T(3)] },
      sections: [
        {
          UUID: S(1),
          heading: 'S1',
          items: [
            { UUID: I(1), label: 'i1' },
            { UUID: I(2), label: 'i2' },
          ],
        },
        { UUID: S(2), heading: 'S2', items: [] },
      ],
    });
  });

  it('hydrates empty relations as null and empty arrays', async () => {
    const record = await queryUntyped('HPosts').where({ title: 'Second' }).findFirst();
    deepStrictEqual(record, {
      UUID: P(2),
      _updatedAt: TS,
      title: 'Second',
      author: null,
      tags: [],
      meta: null,
      sections: [],
    });
  });
});

describe('junction order', () => {
  it('reads the owner side in parent-position order', async () => {
    const record = await first().findFirst();
    deepStrictEqual(record?.tags, [T(2), T(1)]);
  });

  it('reads the inverse side in target-position order', async () => {
    const red = await queryUntyped('HTags').where({ label: 'red' }).findFirst();
    deepStrictEqual(red?.posts, [P(1), P(3)]);
    const green = await queryUntyped('HTags').where({ label: 'green' }).findFirst();
    deepStrictEqual(green?.posts, [P(1)]);
    const blue = await queryUntyped('HTags').where({ label: 'blue' }).findFirst();
    deepStrictEqual(blue?.posts, []);
  });
});

describe('populate', () => {
  it('swaps a record foreign key for the full target, or null', async () => {
    const rows = await queryUntyped('HPosts').populate('author').orderBy('title').findMany();
    deepStrictEqual(rows[0]?.author, { UUID: A(1), _updatedAt: TS, name: 'Ada' });
    deepStrictEqual(rows.find((row) => row.title === 'Second')?.author, null);
    deepStrictEqual(rows.find((row) => row.title === 'Third')?.author, {
      UUID: A(2),
      _updatedAt: TS,
      name: 'Alan',
    });
  });

  it('shares one target reference across every parent that links it', async () => {
    const rows = await queryUntyped('HPosts')
      .where({ author: A(1) })
      .populate('author')
      .findMany();
    strictEqual(rows.length, 2);
    ok(rows[0]?.author === rows[1]?.author);
  });

  it('swaps a records list for ordered targets, leaving their own relations as UUIDs', async () => {
    const record = await first().populate('tags').findFirst();
    const tags = record?.tags as Record<string, unknown>[];
    deepStrictEqual(
      tags.map((each) => each.label),
      ['green', 'red'],
    );
    deepStrictEqual(tags[0], { UUID: T(2), _updatedAt: TS, label: 'green', posts: [P(1)] });
    deepStrictEqual(tags[1]?.posts, [P(1), P(3)]);
  });
});

describe('select gating', () => {
  it('skips a loader for an unselected relation, running one for a selected one', async () => {
    queries = 0;
    await first().select('title').findMany();
    strictEqual(queries, 1);

    queries = 0;
    await first().select('title', 'tags').findMany();
    strictEqual(queries, 2);
  });
});

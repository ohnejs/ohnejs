import { deepStrictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { buildDesiredSchema } from '../../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../../src/ohne/database/use-database.ts';
import { field } from '../../../../src/ohne/fields/field.ts';
import { useFields } from '../../../../src/ohne/fields/use-fields.ts';
import { queryUntyped } from '../../../../src/ohne/query/query.ts';

useCollections().register('RAuthors', {
  name: 'RAuthors',
  collection: { fields: { name: field('text') } },
});
useCollections().register('RTags', {
  name: 'RTags',
  collection: {
    fields: {
      label: field('text'),
      posts: field('records', { collection: 'RPosts', inverse: 'tags' }),
    },
  },
});
useCollections().register('RPosts', {
  name: 'RPosts',
  collection: {
    fields: {
      title: field('text'),
      views: field('integer'),
      author: field('record', { collection: 'RAuthors' }),
      tags: field('records', { collection: 'RTags' }),
      meta: field('object', { fields: { note: field('text') } }),
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
registerDialect(dialect);
registerDatabase(db);
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never),
});

const id = (kind: string, n: number): string =>
  `00000000-0000-7000-8000-${kind}${n.toString().padStart(11, '0')}`;
const A = (n: number): string => id('a', n);
const T = (n: number): string => id('b', n);
const P = (n: number): string => id('c', n);
const M = (n: number): string => id('d', n);
const S = (n: number): string => id('e', n);
const I = (n: number): string => id('f', n);

async function author(uuid: string, name: string): Promise<void> {
  await db.run('INSERT INTO "RAuthors" ("UUID","_updatedAt","name") VALUES (?,?,?)', [
    uuid,
    0,
    name,
  ]);
}
async function tag(uuid: string, label: string): Promise<void> {
  await db.run('INSERT INTO "RTags" ("UUID","_updatedAt","label") VALUES (?,?,?)', [
    uuid,
    0,
    label,
  ]);
}
async function post(uuid: string, title: string, views: number, a: string | null): Promise<void> {
  await db.run(
    'INSERT INTO "RPosts" ("UUID","_updatedAt","title","views","author") VALUES (?,?,?,?,?)',
    [uuid, 0, title, views, a],
  );
}
async function link(p: string, t: string, pPos: number, tPos: number): Promise<void> {
  await db.run(
    'INSERT INTO "RPosts_tags" ("_parentUUID","_targetUUID","_parentPosition","_targetPosition") VALUES (?,?,?,?)',
    [p, t, pPos, tPos],
  );
}
async function metaRow(uuid: string, parent: string, note: string): Promise<void> {
  await db.run('INSERT INTO "RPosts_meta" ("UUID","_parentUUID","note") VALUES (?,?,?)', [
    uuid,
    parent,
    note,
  ]);
}
async function section(uuid: string, parent: string, pos: number, heading: string): Promise<void> {
  await db.run(
    'INSERT INTO "RPosts_sections" ("UUID","_parentUUID","_parentPosition","heading") VALUES (?,?,?,?)',
    [uuid, parent, pos, heading],
  );
}
async function item(uuid: string, parent: string, pos: number, label: string): Promise<void> {
  await db.run(
    'INSERT INTO "RPosts_sections_items" ("UUID","_parentUUID","_parentPosition","label") VALUES (?,?,?,?)',
    [uuid, parent, pos, label],
  );
}

await author(A(1), 'Ada');
await author(A(2), 'Alan');
await tag(T(1), 'red');
await tag(T(2), 'green');
await tag(T(3), 'blue');
await post(P(1), 'First', 100, A(1));
await post(P(2), 'Second', 50, null);
await post(P(3), 'Third', 100, A(2));
await post(P(4), 'Fourth', 20, A(1));
await link(P(1), T(1), 0, 0);
await link(P(1), T(2), 1, 0);
await link(P(3), T(1), 1, 1);
await metaRow(M(1), P(1), 'm1');
await metaRow(M(3), P(3), 'm3');
await section(S(1), P(1), 0, 'Intro');
await item(I(1), S(1), 0, 'a');
await item(I(2), S(1), 1, 'b');
await section(S(3), P(3), 0, 'Body');
await item(I(3), S(3), 0, 'zzz');

async function titles(builder: ReturnType<typeof queryUntyped>): Promise<string[]> {
  return (await builder.orderBy('title').findMany()).map((row) => row.title as string);
}
async function labels(builder: ReturnType<typeof queryUntyped>): Promise<string[]> {
  return (await builder.orderBy('label').findMany()).map((row) => row.label as string);
}
const posts = (): ReturnType<typeof queryUntyped> => queryUntyped('RPosts');
const tags = (): ReturnType<typeof queryUntyped> => queryUntyped('RTags');

describe('record conditions', () => {
  it('bare has tests the foreign key; empty its null', async () => {
    deepStrictEqual(await titles(posts().where({ author: { has: true } })), [
      'First',
      'Fourth',
      'Third',
    ]);
    deepStrictEqual(await titles(posts().where({ author: { empty: true } })), ['Second']);
  });

  it('a conditioned has filters the target', async () => {
    deepStrictEqual(await titles(posts().where({ author: { has: { name: 'Ada' } } })), [
      'First',
      'Fourth',
    ]);
  });

  it('a negated has keeps the rows the relation does not reach, null included', async () => {
    deepStrictEqual(await titles(posts().where({ author: { not: { has: { name: 'Ada' } } } })), [
      'Second',
      'Third',
    ]);
  });
});

describe('records conditions', () => {
  it('bare has and empty split the tagged from the untagged', async () => {
    deepStrictEqual(await titles(posts().where({ tags: { has: true } })), ['First', 'Third']);
    deepStrictEqual(await titles(posts().where({ tags: { empty: true } })), ['Fourth', 'Second']);
  });

  it('a conditioned has filters the joined target', async () => {
    deepStrictEqual(await titles(posts().where({ tags: { has: { label: 'green' } } })), ['First']);
  });

  it('folds a grouped condition inside a has target scope', async () => {
    deepStrictEqual(
      await titles(
        posts().where({ tags: { has: { or: [{ label: 'red' }, { label: 'green' }] } } }),
      ),
      ['First', 'Third'],
    );
  });

  it('the inverse side reads the same junction with roles swapped', async () => {
    deepStrictEqual(await labels(tags().where({ posts: { has: { title: 'First' } } })), [
      'green',
      'red',
    ]);
    deepStrictEqual(await labels(tags().where({ posts: { empty: true } })), ['blue']);
  });
});

describe('composite conditions', () => {
  it('a child-one has and empty read the object table', async () => {
    deepStrictEqual(await titles(posts().where({ meta: { has: { note: 'm1' } } })), ['First']);
    deepStrictEqual(await titles(posts().where({ meta: { empty: true } })), ['Fourth', 'Second']);
  });

  it('a child-many has reads the repeater table', async () => {
    deepStrictEqual(await titles(posts().where({ sections: { has: { heading: 'Intro' } } })), [
      'First',
    ]);
  });

  it('nested has descends two composite levels', async () => {
    deepStrictEqual(
      await titles(posts().where({ sections: { has: { items: { has: { label: 'zzz' } } } } })),
      ['Third'],
    );
  });
});

describe('has composes with the rest of the where', () => {
  it('ANDs with sibling scalar conditions', async () => {
    deepStrictEqual(
      await titles(posts().where({ views: { atLeast: 100 }, author: { has: { name: 'Ada' } } })),
      ['First'],
    );
  });
});

describe('whereAny', () => {
  it('ORs its branches', async () => {
    deepStrictEqual(
      await titles(
        posts().whereAny((q) => [q.where({ title: 'First' }), q.where({ title: 'Third' })]),
      ),
      ['First', 'Third'],
    );
  });

  it('ANDs the conditions chained onto one branch', async () => {
    deepStrictEqual(
      await titles(
        posts().whereAny((q) => [
          q.where({ views: 100 }).where({ author: { has: { name: 'Ada' } } }),
        ]),
      ),
      ['First'],
    );
  });

  it('carries a has inside a branch', async () => {
    deepStrictEqual(
      await titles(
        posts().whereAny((q) => [
          q.where({ author: { has: { name: 'Alan' } } }),
          q.where({ views: { atLeast: 100 } }),
        ]),
      ),
      ['First', 'Third'],
    );
  });

  it('nests a further group inside a branch', async () => {
    deepStrictEqual(
      await titles(
        posts().whereAny((q) => [
          q.where({ views: { atLeast: 100 } }),
          q.whereAny((qq) => [qq.where({ title: 'Second' }), qq.where({ title: 'Fourth' })]),
        ]),
      ),
      ['First', 'Fourth', 'Second', 'Third'],
    );
  });

  it('ANDs onto a preceding where', async () => {
    deepStrictEqual(
      await titles(
        posts()
          .where({ views: { atLeast: 100 } })
          .whereAny((q) => [
            q.where({ author: { has: { name: 'Ada' } } }),
            q.where({ author: { has: { name: 'Alan' } } }),
          ]),
      ),
      ['First', 'Third'],
    );
  });

  it('with zero branches matches nothing', async () => {
    deepStrictEqual(await titles(posts().whereAny(() => [])), []);
  });
});

describe('nested condition gating', () => {
  it('rejects an unknown field inside a has, scoped to the target', () => {
    throws(() => posts().where({ author: { has: { nope: 1 } } }));
    throws(() => posts().where({ tags: { has: { nope: 1 } } }));
  });

  it('rejects an operator the target field does not admit', () => {
    throws(() => posts().where({ author: { has: { name: { has: true } } } }));
  });

  it('rejects has on a scalar field', () => {
    throws(() => posts().where({ title: { has: true } }));
  });
});

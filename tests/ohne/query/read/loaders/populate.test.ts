import { deepStrictEqual, match, notStrictEqual, ok, strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import type { DatabaseAdapter, SQLParams } from '../../../../../src/ohne/database/adapter.ts';

import { useCollections } from '../../../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { buildDesiredSchema } from '../../../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../../../src/ohne/database/schema/sync.ts';
import {
  registerDatabase,
  registerDialect,
} from '../../../../../src/ohne/database/use-database.ts';
import { isOhneError } from '../../../../../src/ohne/error/ohne-error.ts';
import { field } from '../../../../../src/ohne/fields/field.ts';
import { useFields } from '../../../../../src/ohne/fields/use-fields.ts';
import { useLayers } from '../../../../../src/ohne/layers/use-layers.ts';
import { queryUntyped } from '../../../../../src/ohne/query/query.ts';

useLayers().add({
  path: '/populate-loaders',
  input: { collections: { locales: ['en', 'de'], defaultLocale: 'en' } },
});

useCollections().register('PAuthors', {
  name: 'PAuthors',
  collection: {
    fields: {
      name: field('text', { translatable: true }),
      email: field('text'),
    },
  },
});
useCollections().register('PComments', {
  name: 'PComments',
  collection: {
    fields: {
      text: field('text'),
      author: field('record', { collection: 'PAuthors' }),
    },
  },
});
useCollections().register('PPosts', {
  name: 'PPosts',
  collection: {
    fields: {
      title: field('text', { translatable: true }),
      author: field('record', { collection: 'PAuthors' }),
      editor: field('record', { collection: 'PAuthors' }),
      comments: field('records', { collection: 'PComments' }),
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

async function create(collection: string, input: Record<string, unknown>): Promise<string> {
  const record = await queryUntyped(collection).createOrThrow(input);
  return record.UUID as string;
}

const ada = await create('PAuthors', { name: 'Ada', email: 'ada@ohne.dev' });
const alan = await create('PAuthors', { name: 'Alan', email: 'alan@ohne.dev' });
await queryUntyped('PAuthors').locale('de').where({ UUID: ada }).updateOrThrow({
  name: 'Ada (de)',
});

const c1 = await create('PComments', { text: 'c1', author: ada });
const c2 = await create('PComments', { text: 'c2', author: alan });
const c3 = await create('PComments', { text: 'c3' });

const p1 = await create('PPosts', {
  title: 'First',
  author: ada,
  editor: ada,
  comments: [c1, c2, c3],
});
await create('PPosts', { title: 'Second', author: ada, editor: alan, comments: [c2] });

const posts = (): ReturnType<typeof queryUntyped> => queryUntyped('PPosts');
const first = (): ReturnType<typeof queryUntyped> => posts().where({ UUID: p1 });

describe('subselect exactness', () => {
  it('returns exactly the named subfields', async () => {
    const record = await first()
      .populate('author', (a) => a.select('name'))
      .findFirst();
    deepStrictEqual(record?.author, { name: 'Ada' });
  });

  it('returns UUID and _updatedAt only when named', async () => {
    const record = await first()
      .populate('author', (a) => a.select('UUID', 'name'))
      .findFirst();
    deepStrictEqual(record?.author, { UUID: ada, name: 'Ada' });

    const stamped = await first()
      .populate('author', (a) => a.select('_updatedAt'))
      .findFirst();
    const author = stamped?.author as Record<string, unknown>;
    deepStrictEqual(Object.keys(author), ['_updatedAt']);
    strictEqual(typeof author._updatedAt, 'number');
  });

  it('keeps the whole record when the callback names no subselect', async () => {
    const record = await first().populate('author').findFirst();
    const author = record?.author as Record<string, unknown>;
    deepStrictEqual(Object.keys(author), ['UUID', '_updatedAt', 'name', 'email']);
  });
});

describe('deep population', () => {
  it('recurses the spec through a records relation', async () => {
    const record = await first()
      .select('title', 'comments')
      .populate('comments', (c) =>
        c.select('text', 'author').populate('author', (a) => a.select('name')),
      )
      .findFirst();
    deepStrictEqual(record, {
      title: 'First',
      comments: [
        { text: 'c1', author: { name: 'Ada' } },
        { text: 'c2', author: { name: 'Alan' } },
        { text: 'c3', author: null },
      ],
    });
  });

  it('descends from a whole-record node when no subselect gates it', async () => {
    const record = await first()
      .populate('comments', (c) => c.populate('author'))
      .findFirst();
    const comments = record?.comments as Record<string, unknown>[];
    strictEqual(comments[0]?.UUID, c1);
    const author = comments[0]?.author as Record<string, unknown> | undefined;
    deepStrictEqual(author?.email, 'ada@ohne.dev');
  });

  it('drops a populated child the subselect does not name', async () => {
    const record = await first()
      .populate('comments', (c) => c.select('text').populate('author'))
      .findFirst();
    deepStrictEqual(record?.comments, [{ text: 'c1' }, { text: 'c2' }, { text: 'c3' }]);
  });

  it('threads the locale verbatim to every depth', async () => {
    const record = await first()
      .locale('de')
      .populate('comments', (c) =>
        c.select('text', 'author').populate('author', (a) => a.select('name')),
      )
      .findFirst();
    deepStrictEqual(record?.comments, [
      { text: 'c1', author: { name: 'Ada (de)' } },
      { text: 'c2', author: { name: null } },
      { text: 'c3', author: null },
    ]);
  });

  it('reads one batched statement per tree node, deduped across parents', async () => {
    queries = 0;
    await posts()
      .select('title', 'comments')
      .populate('comments', (c) =>
        c.select('text', 'author').populate('author', (a) => a.select('name')),
      )
      .findMany();
    strictEqual(queries, 4);
  });
});

describe('reference sharing', () => {
  it('shares one target object within a node', async () => {
    const rows = await posts()
      .populate('author', (a) => a.select('name'))
      .findMany();
    strictEqual(rows.length, 2);
    ok(rows[0]?.author === rows[1]?.author);
  });

  it('loads independent copies for sibling nodes on the same collection', async () => {
    const record = await first().populate('author').populate('editor').findFirst();
    deepStrictEqual(record?.author, record?.editor);
    notStrictEqual(record?.author, record?.editor);
  });
});

describe('the spec object form', () => {
  it('builds the same tree the callback form does', async () => {
    const viaSpec = await first()
      .populate({
        comments: { select: ['text', 'author'], populate: [{ author: { select: ['name'] } }] },
      })
      .findFirst();
    const viaCallback = await first()
      .populate('comments', (c) =>
        c.select('text', 'author').populate('author', (a) => a.select('name')),
      )
      .findFirst();
    deepStrictEqual(viaSpec, viaCallback);
  });
});

describe('duplicate rejection', () => {
  it('dedups a bare repeat of a bare populate', async () => {
    const record = await first().populate('author').populate('author').findFirst();
    const author = record?.author as Record<string, unknown> | undefined;
    deepStrictEqual(author?.name, 'Ada');
  });

  it('rejects a repeat involving a spec', () => {
    throws(
      () =>
        first()
          .populate('author')
          .populate('author', (a) => a.select('name')),
      (error: unknown) => {
        ok(isOhneError(error));
        match(error.title ?? '', /Duplicate populate on `author`/);
        return true;
      },
    );
  });
});

describe('validation at the populate call', () => {
  it('rejects an empty subselect', () => {
    throws(
      () => first().populate('author', (a) => a.select()),
      (error: unknown) => {
        ok(isOhneError(error));
        match(error.title ?? '', /Empty populate subselect on `author`/);
        return true;
      },
    );
  });

  it('rejects an unknown subselect name, scoped to the target', () => {
    throws(
      () => first().populate('author', (a) => a.select('nope')),
      (error: unknown) => {
        ok(isOhneError(error));
        match(error.title ?? '', /Unknown field `nope` on `PAuthors`/);
        return true;
      },
    );
  });

  it('rejects a nested populate of a non-relation subfield', () => {
    throws(
      () => first().populate('comments', (c) => c.populate('text')),
      (error: unknown) => {
        ok(isOhneError(error));
        match(error.title ?? '', /Cannot populate `text`/);
        return true;
      },
    );
  });

  it('rejects an entry that is neither a name, a spec, nor a callback pair', () => {
    throws(
      () => first().populate(42 as never),
      (error: unknown) => {
        ok(isOhneError(error));
        match(error.title ?? '', /Invalid `populate` entry/);
        return true;
      },
    );
  });

  it('rejects a spec value that is not an object', () => {
    throws(
      () => first().populate({ author: 5 } as never),
      (error: unknown) => {
        ok(isOhneError(error));
        match(error.title ?? '', /Invalid populate spec for `author`/);
        return true;
      },
    );
  });
});

describe('pluck through a populate node', () => {
  it('plucks the node-narrowed rows, never raw foreign keys', async () => {
    const plucked = await first()
      .populate('comments', (c) => c.select('text'))
      .pluck('comments');
    deepStrictEqual(plucked, [[{ text: 'c1' }, { text: 'c2' }, { text: 'c3' }]]);
  });
});

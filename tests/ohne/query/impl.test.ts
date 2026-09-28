import { deepStrictEqual, match, ok, rejects, strictEqual, throws } from 'node:assert';
import { afterEach, describe, it } from 'node:test';

import { useCollections } from '../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { buildDesiredSchema } from '../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../src/ohne/database/use-database.ts';
import { isOhneError, ohneError } from '../../../src/ohne/error/ohne-error.ts';
import { field } from '../../../src/ohne/fields/field.ts';
import { useFields } from '../../../src/ohne/fields/use-fields.ts';
import { hook } from '../../../src/ohne/hooks/hook.ts';
import { useHooks } from '../../../src/ohne/hooks/use-hooks.ts';
import { useLayers } from '../../../src/ohne/layers/use-layers.ts';
import { queryUntyped } from '../../../src/ohne/query/query.ts';
import { runCreate } from '../../../src/ohne/query/write/create.ts';
import { isNull } from '../../../src/utils/index.ts';

useLayers().add({
  path: '/impl',
  input: { collections: { locales: ['en', 'de'], defaultLocale: 'en' } },
});

useCollections().register('IPosts', {
  name: 'IPosts',
  collection: {
    fields: { title: field('text'), views: field('integer'), featured: field('boolean') },
  },
});
useCollections().register('INotes', {
  name: 'INotes',
  collection: {
    fields: { title: field('text', { translatable: true }), body: field('text') },
  },
});

useCollections().register('ISettings', {
  name: 'ISettings',
  collection: {
    singleton: true,
    fields: {
      title: field('text', { translatable: true, default: 'My site' }),
      theme: field('text', { default: 'light' }),
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

await runCreate('ISettings', {}, null);

let counter = 0;
async function insert(title: string, views: number, featured: boolean): Promise<void> {
  counter += 1;
  await db.run(
    'INSERT INTO "IPosts" ("UUID","_updatedAt","title","views","featured") VALUES (?,?,?,?,?)',
    [`00000000-0000-7000-8000-00000000000${counter}`, 0, title, views, featured ? 1 : 0],
  );
}
await insert('Alpha', 100, true);
await insert('Beta', 50, false);
await insert('Gamma', 100, false);

async function titles(builder: ReturnType<typeof queryUntyped>): Promise<string[]> {
  return (await builder.findMany()).map((row) => row.title as string);
}

describe('QueryBuilderImpl accumulation', () => {
  it('ANDs successive where calls', async () => {
    deepStrictEqual(
      await titles(queryUntyped('IPosts').where({ views: 100 }).where({ featured: true })),
      ['Alpha'],
    );
  });

  it('accumulates selected fields across calls', async () => {
    const rows = await queryUntyped('IPosts')
      .select('title')
      .select('views')
      .where({ title: 'Alpha' })
      .findMany();
    deepStrictEqual(rows, [{ title: 'Alpha', views: 100 }]);
  });

  it('treats a zero-arg select as a no-op, reading the whole record', async () => {
    const rows = await queryUntyped('IPosts').select().where({ title: 'Alpha' }).findMany();
    strictEqual(rows.length, 1);
    strictEqual(rows[0].title, 'Alpha');
    ok('UUID' in rows[0]);
    const narrowed = await queryUntyped('IPosts')
      .select('title')
      .select()
      .where({ title: 'Alpha' })
      .findMany();
    deepStrictEqual(narrowed, [{ title: 'Alpha' }]);
  });

  it('stacks order keys in priority order', async () => {
    deepStrictEqual(
      await titles(queryUntyped('IPosts').orderBy('views', 'desc').orderBy('title')),
      ['Alpha', 'Gamma', 'Beta'],
    );
  });

  it('keeps the first direction when a field is ordered twice', async () => {
    deepStrictEqual(
      await titles(queryUntyped('IPosts').orderBy('views', 'asc').orderBy('views', 'desc')),
      ['Beta', 'Alpha', 'Gamma'],
    );
  });

  it('replaces limit and offset, last call winning', async () => {
    strictEqual((await queryUntyped('IPosts').limit(1).limit(3).findMany()).length, 3);
    deepStrictEqual(await titles(queryUntyped('IPosts').orderBy('title').offset(2).offset(1)), [
      'Beta',
      'Gamma',
    ]);
  });
});

describe('QueryBuilderImpl gating', () => {
  it('rejects an unknown field, suggesting the closest one', () => {
    throws(
      () => queryUntyped('IPosts').where({ tite: 'x' }),
      (error: unknown) => {
        ok(isOhneError(error));
        match(error.title ?? '', /Unknown field `tite`/);
        match([error.body].flat().join('\n'), /Did you mean `title`/);
        return true;
      },
    );
  });

  it('rejects an operator the field does not admit', () => {
    throws(
      () => queryUntyped('IPosts').where({ views: { contains: 'x' } }),
      (error: unknown) => {
        ok(isOhneError(error));
        match(error.title ?? '', /Operator `contains` does not apply to `views`/);
        return true;
      },
    );
  });

  it('rejects null equality, naming isNull through the parse error', () => {
    throws(
      () => queryUntyped('IPosts').where({ views: null }),
      (error: unknown) => {
        ok(isOhneError(error));
        match(error.title ?? '', /Invalid condition/);
        return true;
      },
    );
  });

  it('rejects an unknown select or order field', () => {
    throws(
      () => queryUntyped('IPosts').select('nope'),
      (error: unknown) => isOhneError(error),
    );
    throws(
      () => queryUntyped('IPosts').orderBy('nope'),
      (error: unknown) => isOhneError(error),
    );
  });
});

describe('QueryBuilderImpl populate', () => {
  it('rejects populating a field that is not a relation', () => {
    throws(
      () => queryUntyped('IPosts').populate('title'),
      (error: unknown) => {
        ok(isOhneError(error));
        match(error.title ?? '', /Cannot populate `title`/);
        return true;
      },
    );
  });

  it('rejects populating an unknown field', () => {
    throws(
      () => queryUntyped('IPosts').populate('nope'),
      (error: unknown) => isOhneError(error),
    );
  });
});

describe('QueryBuilderImpl pluck', () => {
  it('reads one field from every matching row', async () => {
    deepStrictEqual(await queryUntyped('IPosts').orderBy('title').pluck('title'), [
      'Alpha',
      'Beta',
      'Gamma',
    ]);
  });

  it('rejects plucking an unknown field', () => {
    throws(
      () => queryUntyped('IPosts').pluck('nope'),
      (error: unknown) => isOhneError(error),
    );
  });
});

describe('QueryBuilderImpl locale', () => {
  it('returns the same builder for further chaining', () => {
    const builder = queryUntyped('INotes');
    strictEqual(builder.locale('de'), builder);
  });

  it('threads the locale into the executed read', async () => {
    const created = await queryUntyped('INotes').create({ title: 'Hello', body: 'greeting' });
    ok(created.ok);
    const de = await queryUntyped('INotes').locale('de').where({ body: 'greeting' }).findFirst();
    strictEqual(de?.title, null);
    const en = await queryUntyped('INotes').where({ body: 'greeting' }).findFirst();
    strictEqual(en?.title, 'Hello');
  });

  it('canonicalizes the tag and rejects a second locale', () => {
    throws(
      () => queryUntyped('INotes').locale('DE').locale('de'),
      (error: unknown) => {
        ok(isOhneError(error));
        match(error.title ?? '', /Locale already set/);
        match([error.body].flat().join('\n'), /already reads `de`/);
        return true;
      },
    );
  });

  it('rejects a locale on a collection without translatable fields', () => {
    throws(
      () => queryUntyped('IPosts').locale('de'),
      (error: unknown) => {
        ok(isOhneError(error));
        match(error.title ?? '', /Cannot set a locale on `IPosts`/);
        return true;
      },
    );
  });

  it('rejects a locale outside the configured set', () => {
    throws(
      () => queryUntyped('INotes').locale('fr'),
      (error: unknown) => {
        ok(isOhneError(error));
        match(error.title ?? '', /Unknown locale `fr`/);
        return true;
      },
    );
  });

  it('keeps a joined transaction across locale, rolling its write back with it', async () => {
    const before = await queryUntyped('INotes').count();
    await rejects(
      db.transaction(async (tx) => {
        const created = await queryUntyped('INotes')
          .use(tx)
          .locale('de')
          .create({ title: 'Hallo', body: 'tx' });
        ok(created.ok);
        throw ohneError('roll back');
      }),
      /roll back/,
    );
    strictEqual(await queryUntyped('INotes').count(), before);
  });
});

describe('QueryBuilderImpl singleton', () => {
  const refuses = (operation: string) => (error: unknown) => {
    ok(isOhneError(error));
    strictEqual(error.title, `Cannot \`${operation}\` on singleton \`ISettings\``);
    return true;
  };

  it('refuses `create`, `createOrThrow`, and `delete`', async () => {
    throws(() => queryUntyped('ISettings').create({}), refuses('create'));
    await rejects(queryUntyped('ISettings').createOrThrow({}), refuses('create'));
    throws(() => queryUntyped('ISettings').delete(), refuses('delete'));
    throws(() => queryUntyped('ISettings').where({ theme: 'light' }).delete(), refuses('delete'));
    strictEqual(await queryUntyped('ISettings').count(), 1);
  });

  it('updates the one record without a filter', async () => {
    const outcome = await queryUntyped('ISettings').update({ theme: 'dark' });
    ok(outcome.ok);
    strictEqual(outcome.records.length, 1);
    strictEqual(outcome.records[0].theme, 'dark');
    const [record] = await queryUntyped('ISettings').updateOrThrow({ theme: 'light' });
    strictEqual(record.theme, 'light');
  });

  it('still honors a filter, matching nothing when it misses', async () => {
    const records = await queryUntyped('ISettings')
      .where({ theme: 'absent' })
      .updateOrThrow({ theme: 'x' });
    deepStrictEqual(records, []);
    strictEqual((await queryUntyped('ISettings').findFirst())?.theme, 'light');
  });

  it('drops one locale without a filter, keeping the record', async () => {
    await queryUntyped('ISettings').locale('de').update({ title: 'Meine Seite' });
    deepStrictEqual(await queryUntyped('ISettings').locale('de').deleteTranslation(), {
      deleted: 1,
    });
    const de = await queryUntyped('ISettings').locale('de').findFirst();
    strictEqual(de?.title, null);
    strictEqual((await queryUntyped('ISettings').findFirst())?.title, 'My site');
  });

  it('keeps the filter requirement on a plain collection', () => {
    throws(() => queryUntyped('IPosts').update({ views: 1 }), /without a filter/);
  });
});

const accessed = (await queryUntyped('INotes').createOrThrow({ title: 'Open', body: 'access' }))
  .UUID as string;
await queryUntyped('INotes').locale('de').where({ UUID: accessed }).updateOrThrow({ title: 'Zu' });

async function held(builder: ReturnType<typeof queryUntyped>): Promise<unknown> {
  return (await builder.where({ UUID: accessed }).select('_translations').findFirst())
    ?._translations;
}

describe('QueryBuilderImpl access', () => {
  afterEach(() => useHooks().clear());

  it('narrows `_translations` under `access` alone, never under a trusted `where`', async () => {
    deepStrictEqual(await held(queryUntyped('INotes').where({ title: 'Open' })), ['en', 'de']);
    deepStrictEqual(await held(queryUntyped('INotes').access({ title: 'Open' })), ['en']);
  });

  it('probes through `query:filter`, and past it on an unscoped read', async () => {
    const hidden = {
      kind: 'compare',
      path: ['title'],
      op: 'equalsTo',
      value: 'Zu',
      negated: true,
    } as const;
    hook('query:filter', (ir) =>
      isNull(ir.condition)
        ? undefined
        : { ...ir, condition: { kind: 'and', nodes: [ir.condition, hidden] } as const },
    );
    const access = { title: { in: ['Open', 'Zu'] } };
    deepStrictEqual(await held(queryUntyped('INotes').access(access)), ['en']);
    deepStrictEqual(await held(queryUntyped('INotes').unscoped().access(access)), ['en', 'de']);
  });

  it('narrows the records an update answers', async () => {
    const [record] = await queryUntyped('INotes')
      .where({ UUID: accessed })
      .access({ title: 'Open' })
      .updateOrThrow({ body: 'access' });
    deepStrictEqual(record._translations, ['en']);
  });
});

import { deepStrictEqual, match, ok, strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { useCollections } from '../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { buildDesiredSchema } from '../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../src/ohne/database/use-database.ts';
import { isOhneError, ohneError } from '../../../src/ohne/error/ohne-error.ts';
import { field } from '../../../src/ohne/fields/field.ts';
import { useFields } from '../../../src/ohne/fields/use-fields.ts';
import { useLayers } from '../../../src/ohne/layers/use-layers.ts';
import { builderGuards } from '../../../src/ohne/query/impl.ts';
import { queryUntyped } from '../../../src/ohne/query/query.ts';

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

const dialect = new SQLiteDialect();
const db = await dialect.connect(':memory:');
registerDialect(dialect);
registerDatabase(db);
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never),
});

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

describe('QueryBuilderImpl limits', () => {
  it('accumulates overrides per key, the last value winning', () => {
    const builder = queryUntyped('IPosts')
      .guards({ maxSelect: 5 })
      .guards({ maxSelect: 10, maxOrder: 3 });
    deepStrictEqual(builderGuards(builder), { maxSelect: 10, maxOrder: 3 });
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

  it('keeps guard overrides across locale', () => {
    const builder = queryUntyped('INotes')
      .guards({ maxSelect: 5 })
      .locale('de')
      .guards({ maxOrder: 3 });
    deepStrictEqual(builderGuards(builder), { maxSelect: 5, maxOrder: 3 });
  });

  it('keeps a joined transaction across locale, rolling its write back with it', async () => {
    const before = await queryUntyped('INotes').count();
    await db
      .transaction(async (tx) => {
        const created = await queryUntyped('INotes')
          .use(tx)
          .locale('de')
          .create({ title: 'Hallo', body: 'tx' });
        ok(created.ok);
        throw ohneError('roll back');
      })
      .catch(() => undefined);
    strictEqual(await queryUntyped('INotes').count(), before);
  });
});

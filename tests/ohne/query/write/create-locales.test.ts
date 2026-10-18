import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert';
import { afterEach, describe, it } from 'node:test';

import type { RecordCommitted } from '../../../../src/ohne/query/write/committed.ts';

import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { buildDesiredSchema } from '../../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../../src/ohne/database/use-database.ts';
import { field } from '../../../../src/ohne/fields/field.ts';
import { useFields } from '../../../../src/ohne/fields/use-fields.ts';
import { hook } from '../../../../src/ohne/hooks/hook.ts';
import { useHooks } from '../../../../src/ohne/hooks/use-hooks.ts';
import { useLayers } from '../../../../src/ohne/layers/use-layers.ts';
import { queryUntyped } from '../../../../src/ohne/query/query.ts';
import { runCreate } from '../../../../src/ohne/query/write/create.ts';
import { isValidationError } from '../../../../src/ohne/query/write/errors.ts';
import { connectTest, dialect } from '../../../_dialect.ts';

useLayers().add({
  path: '/create-locales',
  input: { collections: { locales: ['en', 'de', 'fr'], defaultLocale: 'en' } },
});

useCollections().register('MPosts', {
  name: 'MPosts',
  collection: {
    fields: {
      title: field('text', { translatable: true }),
      summary: field('text', { translatable: true, nullable: true }),
      views: field('integer', { default: 0 }),
      sections: field('repeater', {
        translatable: true,
        fields: { heading: field('text') },
      }),
    },
  },
});
useCollections().register('MTags', {
  name: 'MTags',
  collection: { fields: { label: field('text') } },
});

const db = await connectTest();
registerDialect(dialect);
registerDatabase(db);
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never),
});

/**
 * How many main and companion rows `MPosts` holds.
 */
async function rows(): Promise<[number, number]> {
  const main = await db.query('SELECT "UUID" FROM "MPosts"');
  const companion = await db.query('SELECT "_parentUUID" FROM "MPosts__translations"');
  return [main.length, companion.length];
}

describe('create with `locales`', () => {
  afterEach(() => useHooks().clear());

  it('writes every locale in one create', async () => {
    const result = await queryUntyped('MPosts').create(
      { title: 'Hello', sections: [{ heading: 'One' }] },
      {
        locales: {
          fr: { title: 'Bonjour' },
          de: { title: 'Hallo', sections: [{ heading: 'Eins' }] },
        },
      },
    );
    ok(result.ok);
    deepStrictEqual(result.record._translations, ['en', 'de', 'fr']);
    const uuid = result.record.UUID as string;
    const de = await queryUntyped('MPosts').locale('de').where({ UUID: uuid }).findFirst();
    strictEqual(de?.title, 'Hallo');
    deepStrictEqual(
      ((de?.sections ?? []) as { heading: string }[]).map((item) => item.heading),
      ['Eins'],
    );
    const fr = await queryUntyped('MPosts').locale('fr').where({ UUID: uuid }).findFirst();
    strictEqual(fr?.title, 'Bonjour');
  });

  it('creates at the chain locale and fills the default', async () => {
    const result = await queryUntyped('MPosts')
      .locale('de')
      .create({ title: 'Hallo' }, { locales: { en: { title: 'Hello' } } });
    ok(result.ok);
    strictEqual(result.record.title, 'Hallo');
    deepStrictEqual(result.record._translations, ['en', 'de']);
  });

  it('unwinds the whole create when one locale fails, naming it', async () => {
    const before = await rows();
    const result = await runCreate('MPosts', { title: 'Kept?' }, null, undefined, false, null, {
      de: { summary: 'no title' },
    });
    ok(!result.ok);
    strictEqual(result.locale, 'de');
    strictEqual(result.errors.title, 'validation.required');
    deepStrictEqual(await rows(), before);
  });

  it('unwinds only itself inside a joined transaction', async () => {
    const before = await rows();
    await db.transaction(async (tx) => {
      await db.run('INSERT INTO "MTags" ("UUID","_updatedAt","label") VALUES (?,?,?)', [
        'joined',
        1,
        'Kept',
      ]);
      const result = await queryUntyped('MPosts')
        .use(tx)
        .create({ title: 'Gone' }, { locales: { fr: { summary: 'no title' } } });
      ok(!result.ok);
      strictEqual(result.locale, 'fr');
    });
    deepStrictEqual(await rows(), before);
    strictEqual(
      (await db.query('SELECT "UUID" FROM "MTags" WHERE "UUID" = ?', ['joined'])).length,
      1,
    );
  });

  it('throws the failing locale through `createOrThrow`', async () => {
    await rejects(
      queryUntyped('MPosts').createOrThrow({ title: 'X' }, { locales: { de: { summary: 'x' } } }),
      (error) => isValidationError(error) && error.locale === 'de' && 'title' in error.errors,
    );
  });

  it('skips an empty locale', async () => {
    const result = await queryUntyped('MPosts').create({ title: 'Solo' }, { locales: { de: {} } });
    ok(result.ok);
    deepStrictEqual(result.record._translations, ['en']);
  });

  it('fires the create hooks once and no update hook', async () => {
    const seen: string[] = [];
    const committed: RecordCommitted[] = [];
    let translations: unknown;
    hook('record:before-change', (_input, { operation }) => {
      seen.push(`change:${operation}`);
    });
    hook('record:validate', (_errors, _scope, { operation }) => {
      seen.push(`validate:${operation}`);
    });
    hook('record:before-update', () => {
      seen.push('before-update');
    });
    hook('record:after-update', () => {
      seen.push('after-update');
    });
    hook('record:after-create', (record) => {
      seen.push('after-create');
      translations = record._translations;
    });
    hook('record:committed', (event) => {
      committed.push(event);
    });
    const result = await queryUntyped('MPosts').create(
      { title: 'Hooks' },
      { locales: { de: { title: 'Haken' } } },
    );
    ok(result.ok);
    deepStrictEqual(seen, [
      'change:create',
      'validate:create',
      'change:update',
      'validate:update',
      'after-create',
    ]);
    deepStrictEqual(translations, ['en', 'de']);
    deepStrictEqual(committed, [
      { collection: 'MPosts', operation: 'create', uuids: [result.record.UUID] },
    ]);
  });

  it('refuses `locales` that misuse the create', async () => {
    const posts = queryUntyped('MPosts');
    await rejects(posts.create({ title: 'X' }, { locales: { en: { title: 'Y' } } }), /own locale/);
    await rejects(
      posts.create({ title: 'X' }, { locales: { it: { title: 'Y' } } }),
      /Unknown locale/,
    );
    await rejects(
      posts.create({ title: 'X' }, { locales: { de: { views: 3 } } }),
      /`locales.de.views` is not translatable/,
    );
    await rejects(
      queryUntyped('MTags').create({ label: 'X' }, { locales: { de: { label: 'Y' } } }),
      /Cannot create `MTags` with `locales`/,
    );
  });

  it('reports an unknown key in a locale as a field error at that locale', async () => {
    const result = await queryUntyped('MPosts').create(
      { title: 'X' },
      { locales: { de: { title: 'Y', ghost: 1 } } },
    );
    ok(!result.ok);
    strictEqual(result.locale, 'de');
    ok('ghost' in result.errors);
  });
});

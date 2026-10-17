import { deepStrictEqual, notStrictEqual, ok, rejects, strictEqual } from 'node:assert';
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
import { useLayers } from '../../../../src/ohne/layers/use-layers.ts';
import { queryUntyped } from '../../../../src/ohne/query/query.ts';
import { isValidationError } from '../../../../src/ohne/query/write/errors.ts';

useLayers().add({
  path: '/duplicate',
  input: { collections: { locales: ['en', 'de', 'fr'], defaultLocale: 'en' } },
});

useFields().register('testSecret', {
  name: 'testSecret' as FieldTypeName,
  fieldType: defineField({ columnType: 'text', copy: false }),
});

const secret = { type: 'testSecret', options: { nullable: true } } as unknown as FieldInstance;

useCollections().register('DAuthors', {
  name: 'DAuthors',
  collection: { fields: { name: field('text') } },
});
useCollections().register('DPosts', {
  name: 'DPosts',
  collection: {
    fields: {
      title: field('text', { translatable: true }),
      slug: field('text', {
        translatable: true,
        unique: true,
        uniquePerLocale: true,
        nullable: true,
      }),
      code: field('text', { unique: true, nullable: true }),
      token: secret,
      views: field('integer', { default: 0 }),
      stamp: field('integer', { nullable: true, writable: false }),
      origin: field('text', { nullable: true, immutable: true }),
      author: field('record', { collection: 'DAuthors' }),
      sections: field('repeater', {
        translatable: true,
        fields: { heading: field('text') },
      }),
    },
  },
});
useCollections().register('DPages', {
  name: 'DPages',
  collection: {
    fields: {
      title: field('text', { translatable: true }),
      slug: field('text', { translatable: true, unique: true, uniquePerLocale: true }),
    },
    duplicate: ({ source, input, locale }) => ({
      ...input,
      title: `${source.title as string} (copy)`,
      slug: `${source.slug as string}-copy-${locale}`,
      ghost: 'never written',
    }),
  },
});
useCollections().register('DArticles', {
  name: 'DArticles',
  collection: {
    fields: {
      title: field('text', { translatable: true }),
      slug: field('text', { translatable: true, unique: true, uniquePerLocale: true }),
    },
  },
});
useCollections().register('DNotes', {
  name: 'DNotes',
  collection: { fields: { body: field('text'), code: field('text', { unique: true }) } },
});
useCollections().register('DStatus', {
  name: 'DStatus',
  collection: {
    fields: {
      title: field('text', { translatable: true }),
      status: field('text', { translatable: true }),
    },
  },
});
useCollections().register('DAccounts', {
  name: 'DAccounts',
  collection: {
    fields: {
      name: field('text'),
      token: { type: 'testSecret', options: {} } as unknown as FieldInstance,
      pin: field('text', { readable: false }),
    },
    duplicate: ({ input }) => ({ ...input, token: 'fresh', pin: '0000' }),
  },
});
useCollections().register('DFiles', {
  name: 'DFiles',
  collection: { duplicate: false, fields: { name: field('text') } },
});
useCollections().register('DSettings', {
  name: 'DSettings',
  collection: { singleton: true, fields: { motto: field('text', { default: '' }) } },
});

const dialect = new SQLiteDialect();
const db = await dialect.connect(':memory:');
registerDialect(dialect);
registerDatabase(db);
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never),
});

const author = await queryUntyped('DAuthors').createOrThrow({ name: 'Ada' });

/**
 * Creates a post held in English and German, and French when `fr` is set.
 */
async function post(name: string, fr = false): Promise<string> {
  const record = await queryUntyped('DPosts').createOrThrow(
    {
      title: name,
      slug: name,
      code: name,
      token: 'raw',
      origin: 'import',
      author: author.UUID,
      sections: [{ heading: `${name} en` }],
    },
    {
      locales: {
        de: { title: `${name} de`, slug: name, sections: [{ heading: `${name} de` }] },
        ...(fr ? { fr: { title: `${name} fr`, slug: name } } : {}),
      },
    },
  );
  return record.UUID as string;
}

describe('duplicate', () => {
  afterEach(() => useHooks().clear());

  it('copies every held locale into a new record, uniques left out', async () => {
    const uuid = await post('one');
    const result = await queryUntyped('DPosts').duplicate(uuid, { slug: 'one-copy' });
    ok(result?.ok);
    const copy = result.record;
    notStrictEqual(copy.UUID, uuid);
    strictEqual(copy.title, 'one');
    strictEqual(copy.slug, 'one-copy');
    strictEqual(copy.code, null);
    strictEqual(copy.token, null);
    strictEqual(copy.origin, 'import');
    strictEqual(copy.author, author.UUID);
    deepStrictEqual(copy._translations, ['en', 'de']);
    const de = await queryUntyped('DPosts').locale('de').where({ UUID: copy.UUID }).findFirst();
    strictEqual(de?.title, 'one de');
    strictEqual(de?.slug, null);
    deepStrictEqual(
      ((de?.sections ?? []) as { heading: string }[]).map((item) => item.heading),
      ['one de'],
    );
  });

  it('copies item rows as fresh rows', async () => {
    const uuid = await post('rows');
    const source = await queryUntyped('DPosts').where({ UUID: uuid }).findFirst();
    const result = await queryUntyped('DPosts').duplicate(uuid, { slug: 'rows-copy' });
    ok(result?.ok);
    const [before] = (source?.sections ?? []) as { UUID: string }[];
    const [after] = result.record.sections as { UUID: string }[];
    notStrictEqual(after.UUID, before.UUID);
  });

  it('lands overrides at the chain locale and creates there', async () => {
    const uuid = await post('chain');
    const result = await queryUntyped('DPosts')
      .locale('de')
      .duplicate(uuid, { slug: 'chain-de', title: 'Kopie' });
    ok(result?.ok);
    strictEqual(result.record.title, 'Kopie');
    strictEqual(result.record.slug, 'chain-de');
    const en = await queryUntyped('DPosts').where({ UUID: result.record.UUID }).findFirst();
    strictEqual(en?.title, 'chain');
    strictEqual(en?.slug, null);
  });

  it('creates at the first held locale when the default is not held', async () => {
    const created = await queryUntyped('DPosts')
      .locale('de')
      .createOrThrow({ title: 'nur de', slug: 'nur-de' });
    const result = await queryUntyped('DPosts').duplicate(created.UUID as string, {
      slug: 'nur-de-2',
    });
    ok(result?.ok);
    deepStrictEqual(result.record._translations, ['de']);
    strictEqual(result.record.title, 'nur de');
  });

  it('copies only shared values into a locale the source does not hold', async () => {
    const uuid = await post('unheld');
    const result = await queryUntyped('DPosts').locale('fr').duplicate(uuid, { slug: 'u-fr' });
    ok(result && !result.ok);
    strictEqual(result.errors.title, 'validation.required');
    const filled = await queryUntyped('DPosts')
      .locale('fr')
      .duplicate(uuid, { slug: 'u-fr', title: 'Copie' });
    ok(filled?.ok);
    deepStrictEqual(filled.record._translations, ['en', 'de', 'fr']);
  });

  it('copies a third held locale', async () => {
    const uuid = await post('three', true);
    const result = await queryUntyped('DPosts').duplicate(uuid, { slug: 'three-copy' });
    ok(result?.ok);
    const fr = await queryUntyped('DPosts')
      .locale('fr')
      .where({ UUID: result.record.UUID })
      .findFirst();
    strictEqual(fr?.title, 'three fr');
  });

  it('fails as `required` at the first locale whose required unique field drops', async () => {
    const article = await queryUntyped('DArticles').createOrThrow(
      { title: 'News', slug: 'news' },
      { locales: { de: { title: 'Neues', slug: 'news' } } },
    );
    const result = await queryUntyped('DArticles').duplicate(article.UUID as string, {
      slug: 'news-2',
    });
    ok(result && !result.ok);
    strictEqual(result.locale, 'de');
    deepStrictEqual(result.errors, { slug: 'validation.required' });
  });

  it('shapes every locale through the collection function and clamps it', async () => {
    const page = await queryUntyped('DPages').createOrThrow(
      { title: 'Home', slug: 'home' },
      { locales: { de: { title: 'Start', slug: 'home' } } },
    );
    const result = await queryUntyped('DPages').duplicate(page.UUID as string);
    ok(result?.ok);
    strictEqual(result.record.title, 'Home (copy)');
    strictEqual(result.record.slug, 'home-copy-en');
    ok(!('ghost' in result.record));
    const de = await queryUntyped('DPages')
      .locale('de')
      .where({ UUID: result.record.UUID })
      .findFirst();
    strictEqual(de?.title, 'Start (copy)');
    strictEqual(de?.slug, 'home-copy-de');
  });

  it('lets overrides win over the collection function', async () => {
    const page = await queryUntyped('DPages').createOrThrow({ title: 'About', slug: 'about' });
    const result = await queryUntyped('DPages').duplicate(page.UUID as string, { slug: 'mine' });
    ok(result?.ok);
    strictEqual(result.record.slug, 'mine');
  });

  it('fails as `notUnique` when the function picks a taken value', async () => {
    const page = await queryUntyped('DPages').createOrThrow({ title: 'Dup', slug: 'dup' });
    ok((await queryUntyped('DPages').duplicate(page.UUID as string))?.ok);
    const again = await queryUntyped('DPages').duplicate(page.UUID as string);
    ok(again && !again.ok);
    strictEqual(again.errors.slug, 'validation.notUnique');
  });

  it('duplicates a collection with no translatable field', async () => {
    const note = await queryUntyped('DNotes').createOrThrow({ body: 'Hi', code: 'n1' });
    const result = await queryUntyped('DNotes').duplicate(note.UUID as string, { code: 'n2' });
    ok(result?.ok);
    strictEqual(result.record.body, 'Hi');
    const missing = await queryUntyped('DNotes').duplicate(note.UUID as string);
    ok(missing && !missing.ok);
    strictEqual(missing.errors.code, 'validation.required');
  });

  it('answers `undefined` for a source the chain cannot read', async () => {
    const uuid = await post('hidden');
    strictEqual(
      await queryUntyped('DPosts').duplicate('00000000-0000-7000-8000-000000000000'),
      undefined,
    );
    strictEqual(await queryUntyped('DPosts').access({ title: 'other' }).duplicate(uuid), undefined);
    strictEqual(
      await queryUntyped('DPosts').duplicateOrThrow('00000000-0000-7000-8000-000000000000'),
      undefined,
    );
  });

  it('copies only what the chain selects', async () => {
    const uuid = await post('picked');
    const result = await queryUntyped('DPosts')
      .select('title', 'slug', '_translations')
      .duplicate(uuid, { slug: 'picked-copy' });
    ok(result?.ok);
    strictEqual(result.record.origin, null);
    strictEqual(result.record.author, null);
  });

  it('duplicates at one locale when the chain selects no `_translations`', async () => {
    const uuid = await post('narrow');
    const result = await queryUntyped('DPosts')
      .select('title', 'slug')
      .duplicate(uuid, { slug: 'narrow-copy' });
    ok(result?.ok);
    deepStrictEqual(result.record._translations, ['en']);
  });

  it('throws the failing locale through `duplicateOrThrow`', async () => {
    const page = await queryUntyped('DPages').createOrThrow(
      { title: 'Taken', slug: 'taken' },
      { locales: { de: { title: 'Belegt', slug: 'taken' } } },
    );
    await queryUntyped('DPages').locale('de').createOrThrow({ title: 'x', slug: 'taken-copy-de' });
    await rejects(
      queryUntyped('DPages').duplicateOrThrow(page.UUID as string),
      (error) =>
        isValidationError(error) &&
        error.locale === 'de' &&
        error.errors.slug === 'validation.notUnique',
    );
  });

  it('fires one `record:committed` create', async () => {
    const uuid = await post('events');
    const operations: string[] = [];
    hook('record:committed', (event) => {
      operations.push(event.operation);
    });
    ok((await queryUntyped('DPosts').duplicate(uuid, { slug: 'events-copy' }))?.ok);
    deepStrictEqual(operations, ['create']);
  });

  it('opens a source its scope shows only at another locale, and copies what it shows', async () => {
    const source = await queryUntyped('DStatus').createOrThrow(
      { title: 'Draft', status: 'draft' },
      { locales: { de: { title: 'Live', status: 'published' } } },
    );
    const result = await queryUntyped('DStatus')
      .access({ status: 'published' })
      .duplicate(source.UUID as string);
    ok(result?.ok);
    strictEqual(result.record.title, 'Live');
    deepStrictEqual(result.record._translations, ['de']);
  });

  it('lets the collection function fill a `copy: false` and an unreadable field', async () => {
    const account = await queryUntyped('DAccounts').createOrThrow({
      name: 'Ada',
      token: 'old',
      pin: '1234',
    });
    const result = await queryUntyped('DAccounts').duplicate(account.UUID as string);
    ok(result?.ok);
    strictEqual(result.record.token, 'fresh');
    const [row] = await db.query<{ pin: string }>(
      'SELECT "pin" FROM "DAccounts" WHERE "UUID" = ?',
      [result.record.UUID as string],
    );
    strictEqual(row?.pin, '0000');
  });

  it('refuses a singleton and a `duplicate: false` collection', async () => {
    await rejects(queryUntyped('DSettings').duplicate('x'), /Cannot `duplicate` on singleton/);
    await rejects(queryUntyped('DFiles').duplicateOrThrow('x'), /Cannot `duplicate` on `DFiles`/);
  });
});

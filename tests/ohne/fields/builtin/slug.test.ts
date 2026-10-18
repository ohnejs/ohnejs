import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { FieldSearchContext } from '../../../../src/ohne/fields/define-field.ts';

import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { buildDesiredSchema } from '../../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../../src/ohne/database/use-database.ts';
import { slug } from '../../../../src/ohne/fields/builtin/slug.ts';
import { searchHook } from '../../../../src/ohne/fields/field-search.ts';
import { field } from '../../../../src/ohne/fields/field.ts';
import { useFields } from '../../../../src/ohne/fields/use-fields.ts';
import * as ohne from '../../../../src/ohne/index.ts';
import { queryUntyped } from '../../../../src/ohne/query/query.ts';
import { isValidationError } from '../../../../src/ohne/query/write/errors.ts';
import { connectTest, dialect } from '../../../_dialect.ts';

type OptionsCtx = Parameters<NonNullable<typeof slug.validateOptions>>[0];

const checkOptions = (options: Record<string, unknown>) =>
  slug.validateOptions!({
    name: 'slug',
    options: { nested: false, ...options },
  } as unknown as OptionsCtx);

useCollections().register('Chronicles', {
  name: 'Chronicles',
  collection: {
    fields: {
      title: field('text'),
      slug: field('slug', { from: 'title', unique: true }),
      path: field('slug', { nested: true, nullable: true }),
      handle: field('slug', {
        nullable: true,
        default: ({ input }: { input: Record<string, unknown> }) => String(input.title ?? ''),
      }),
    },
  },
});

const db = await connectTest();
registerDialect(dialect);
registerDatabase(db);
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never),
});

describe('slug writes', () => {
  it('stores the canonical form', async () => {
    const row = await queryUntyped('Chronicles').createOrThrow({
      title: 'Über uns',
      slug: 'Über uns',
      path: 'Docs / Install',
    });
    deepStrictEqual([row.slug, row.path], ['uber-uns', 'docs/install']);
  });

  it('folds `/` in a flat slug and keeps it in a nested one', async () => {
    const row = await queryUntyped('Chronicles').createOrThrow({
      title: 'AC/DC',
      slug: 'AC/DC',
      path: 'AC/DC',
    });
    deepStrictEqual([row.slug, row.path], ['ac-dc', 'ac/dc']);
  });

  it('rejects input with no Latin letter or digit, and a missing slug', async () => {
    await rejects(
      queryUntyped('Chronicles').createOrThrow({ title: 'Привет', slug: 'Привет' }),
      (error) => isValidationError(error) && error.errors.slug === 'validation.invalidSlug',
    );
    await rejects(
      queryUntyped('Chronicles').createOrThrow({ title: 'No slug' }),
      (error) => isValidationError(error) && error.errors.slug === 'validation.required',
    );
  });

  it('derives through an instance `default`, sanitized like any input', async () => {
    const row = await queryUntyped('Chronicles').createOrThrow({
      title: 'The Lich King',
      slug: 'lich-king',
    });
    strictEqual(row.handle, 'the-lich-king');
  });

  it('keeps the slug when the title changes', async () => {
    const row = await queryUntyped('Chronicles').createOrThrow({ title: 'Arthas', slug: 'arthas' });
    await queryUntyped('Chronicles')
      .where({ UUID: row.UUID })
      .updateOrThrow({ title: 'King Arthas' });
    const [read] = await queryUntyped('Chronicles').where({ UUID: row.UUID }).findMany();
    deepStrictEqual([read?.title, read?.slug], ['King Arthas', 'arthas']);
  });

  it('treats a case variant as taken', async () => {
    await rejects(
      queryUntyped('Chronicles').createOrThrow({ title: 'Again', slug: 'ARTHAS' }),
      (error) => isValidationError(error) && error.errors.slug === 'validation.notUnique',
    );
  });
});

describe('slug options', () => {
  it('accepts a field path in `from`', () => {
    for (const from of ['title', '../title', '/title'])
      strictEqual(checkOptions({ from }), undefined);
  });

  it('refuses a `from` that is no field path', () => {
    deepStrictEqual(checkOptions({ from: 'seo..title' }), [
      '`from` is `seo..title`, which is no field path.',
      'Write it as `when` does: `title`, `../title` or `/title`.',
    ]);
  });
});

describe('slug search', () => {
  const search = (token: string, options: Record<string, unknown> = {}) =>
    searchHook(slug)!({ name: 'slug', options, token } as unknown as FieldSearchContext);

  it('matches the canonical form of the typed word', () => {
    deepStrictEqual(search('AC/DC'), { contains: 'ac-dc' });
    deepStrictEqual(search('Docs/Install', { nested: true }), { contains: 'docs/install' });
  });

  it('gives `null` for a word with nothing to match', () => {
    strictEqual(search('Привет'), null);
  });

  it('is exported from `ohnejs`', () => {
    ok(ohne.slug === slug);
  });
});

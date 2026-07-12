import { deepStrictEqual, match, ok, strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import type { BlockMeta } from '../../../../src/ohne/blocks/use-blocks.ts';
import type { CollectionMeta } from '../../../../src/ohne/collections/use-collections.ts';
import type { FieldInstance } from '../../../../src/ohne/fields/field.ts';

import { buildDesiredSchema } from '../../../../src/ohne/database/schema/desired.ts';
import { isOhneError } from '../../../../src/ohne/error/ohne-error.ts';
import { field } from '../../../../src/ohne/fields/field.ts';
import { useFields } from '../../../../src/ohne/fields/use-fields.ts';
import { createRegistry, type Registry } from '../../../../src/utils/index.ts';

function collections(...metas: CollectionMeta[]): Registry<CollectionMeta> {
  const registry = createRegistry<CollectionMeta>();
  for (const meta of metas) registry.register(meta.name, meta);
  return registry;
}

function blocks(...metas: BlockMeta[]): Registry<BlockMeta> {
  const registry = createRegistry<BlockMeta>();
  for (const meta of metas) registry.register(meta.name, meta);
  return registry;
}

function bodyMatching(pattern: RegExp): (error: unknown) => boolean {
  return (error: unknown) => {
    ok(isOhneError(error));
    match(Array.isArray(error.body) ? error.body.join('\n') : (error.body ?? ''), pattern);
    return true;
  };
}

describe('buildDesiredSchema with translatable scalars', () => {
  it('routes a translatable column to the companion, the main table keeping the rest', () => {
    const tables = buildDesiredSchema(
      collections({
        name: 'Posts',
        collection: {
          fields: { title: field('text', { translatable: true }), views: field('integer') },
        },
      }),
      useFields(),
    );
    deepStrictEqual(
      tables.map((table) => table.name),
      ['Posts', 'Posts__translations'],
    );
    const [main, companion] = tables;
    deepStrictEqual(
      main?.columns.map((column) => column.name),
      ['UUID', '_updatedAt', 'views'],
    );
    deepStrictEqual(companion?.columns, [
      { name: '_parentUUID', type: 'text', notNull: true },
      { name: '_localeCode', type: 'text', notNull: true },
      { name: 'title', type: 'text', notNull: true },
    ]);
    deepStrictEqual(companion?.primaryKey, ['_parentUUID', '_localeCode']);
    deepStrictEqual(companion?.foreignKeys, [
      { column: '_parentUUID', targetTable: 'Posts', targetColumn: 'UUID', onDelete: 'cascade' },
    ]);
    strictEqual(companion?.companion, 'Posts');
  });

  it('emits no companion without a translatable column-bearing field', () => {
    const tables = buildDesiredSchema(
      collections({
        name: 'Posts',
        collection: { fields: { title: field('text') } },
      }),
      useFields(),
    );
    deepStrictEqual(
      tables.map((table) => table.name),
      ['Posts'],
    );
  });

  it('places a translatable field constraint on the companion, per-locale order pinned', () => {
    const tables = buildDesiredSchema(
      collections({
        name: 'Posts',
        collection: {
          fields: {
            slug: field('text', { unique: true, translatable: true }),
            handle: field('text', {
              unique: true,
              translatable: true,
              uniquePerLocale: true,
            }),
            label: field('text', { index: true, translatable: true }),
          },
        },
      }),
      useFields(),
    );
    const companion = tables.find((table) => table.name === 'Posts__translations');
    deepStrictEqual(companion?.uniques, [
      { name: 'UX__Posts__translations__slug', columns: ['slug'] },
      {
        name: 'UX__Posts__translations___localeCode_handle',
        columns: ['_localeCode', 'handle'],
      },
    ]);
    deepStrictEqual(companion?.indexes, [
      { name: 'IX__Posts__translations__label', columns: ['label'] },
    ]);
  });

  it('moves a translatable record foreign key onto the companion column', () => {
    const tables = buildDesiredSchema(
      collections(
        {
          name: 'Posts',
          collection: {
            fields: { author: field('record', { collection: 'Users', translatable: true }) },
          },
        },
        { name: 'Users', collection: { fields: {} } },
      ),
      useFields(),
    );
    const [main, companion] = tables;
    deepStrictEqual(main?.foreignKeys, []);
    deepStrictEqual(companion?.columns.at(-1), { name: 'author', type: 'text', notNull: false });
    deepStrictEqual(companion?.foreignKeys.at(-1), {
      column: 'author',
      targetTable: 'Users',
      targetColumn: 'UUID',
      onDelete: 'setNull',
    });
    deepStrictEqual(companion?.indexes, [
      { name: 'IX__Posts__translations__author', columns: ['author'] },
    ]);
  });
});

describe('buildDesiredSchema with translatable composites and relations', () => {
  it('locale-scopes a translatable junction without touching the companion', () => {
    const tables = buildDesiredSchema(
      collections(
        {
          name: 'Posts',
          collection: {
            fields: { tags: field('records', { collection: 'Tags', translatable: true }) },
          },
        },
        { name: 'Tags', collection: { fields: {} } },
      ),
      useFields(),
    );
    deepStrictEqual(
      tables.map((table) => table.name),
      ['Posts', 'Posts_tags', 'Tags'],
    );
    const junction = tables.find((table) => table.name === 'Posts_tags');
    deepStrictEqual(
      junction?.columns.map((column) => column.name),
      ['_parentUUID', '_targetUUID', '_localeCode', '_parentPosition', '_targetPosition'],
    );
    deepStrictEqual(junction?.uniques, [
      {
        name: 'UX__Posts_tags___parentUUID__targetUUID__localeCode',
        columns: ['_parentUUID', '_targetUUID', '_localeCode'],
      },
    ]);
  });

  it('locale-scopes a translatable object, the parent unique widening', () => {
    const tables = buildDesiredSchema(
      collections({
        name: 'Posts',
        collection: {
          fields: {
            address: field('object', {
              fields: { street: field('text') },
              translatable: true,
            }),
          },
        },
      }),
      useFields(),
    );
    const child = tables.find((table) => table.name === 'Posts_address');
    deepStrictEqual(
      child?.columns.map((column) => column.name),
      ['UUID', '_parentUUID', '_localeCode', 'street'],
    );
    deepStrictEqual(child?.uniques, [
      {
        name: 'UX__Posts_address___parentUUID__localeCode',
        columns: ['_parentUUID', '_localeCode'],
      },
    ]);
  });

  it('locale-scopes a translatable repeater, nested tables staying plain', () => {
    const tables = buildDesiredSchema(
      collections({
        name: 'Posts',
        collection: {
          fields: {
            sections: field('repeater', {
              fields: {
                title: field('text'),
                items: field('repeater', { fields: { label: field('text') } }),
              },
              translatable: true,
            }),
          },
        },
      }),
      useFields(),
    );
    const sections = tables.find((table) => table.name === 'Posts_sections');
    const items = tables.find((table) => table.name === 'Posts_sections_items');
    deepStrictEqual(
      sections?.columns.map((column) => column.name),
      ['UUID', '_parentUUID', '_localeCode', '_parentPosition', 'title'],
    );
    ok(!items?.columns.some((column) => column.name === '_localeCode'));
  });

  it('locale-scopes a translatable blocks wrapper, the per-type tables staying global', () => {
    const tables = buildDesiredSchema(
      collections({
        name: 'Pages',
        collection: {
          fields: { content: field('blocks', { translatable: true }) },
        },
      }),
      useFields(),
      blocks({ name: 'Hero', block: { fields: { heading: field('text') } } }),
    );
    const wrapper = tables.find((table) => table.name === 'Pages_content');
    const hero = tables.find((table) => table.name === 'block_Hero');
    deepStrictEqual(
      wrapper?.columns.map((column) => column.name),
      ['UUID', '_parentUUID', '_localeCode', '_parentPosition', '_blockType', '_blockUUID'],
    );
    ok(!hero?.columns.some((column) => column.name === '_localeCode'));
    deepStrictEqual(
      tables.map((table) => table.name),
      ['Pages', 'Pages_content', 'block_Hero'],
    );
  });
});

describe('buildDesiredSchema composite indexes over translatable fields', () => {
  it('lands an all-translatable entry on the companion', () => {
    const tables = buildDesiredSchema(
      collections({
        name: 'Posts',
        collection: {
          fields: {
            title: field('text', { translatable: true }),
            slug: field('text', { translatable: true }),
          },
          compositeIndexes: [
            { fields: ['title', 'slug'], unique: true },
            { fields: ['slug', 'title'] },
          ],
        },
      }),
      useFields(),
    );
    const companion = tables.find((table) => table.name === 'Posts__translations');
    deepStrictEqual(companion?.uniques, [
      { name: 'UX__Posts__translations__title_slug', columns: ['title', 'slug'] },
    ]);
    deepStrictEqual(companion?.indexes, [
      { name: 'IX__Posts__translations__slug_title', columns: ['slug', 'title'] },
    ]);
  });

  it('rejects an entry mixing translatable and plain fields', () => {
    throws(
      () =>
        buildDesiredSchema(
          collections({
            name: 'Posts',
            collection: {
              fields: {
                title: field('text', { translatable: true }),
                status: field('text'),
              },
              compositeIndexes: [{ fields: ['title', 'status'], unique: true }],
            },
          }),
          useFields(),
        ),
      bodyMatching(/mixes translatable and plain fields/),
    );
  });
});

describe('buildDesiredSchema translatable validation', () => {
  it('rejects a translatable subfield: the composite is per-locale as a whole', () => {
    throws(
      () =>
        buildDesiredSchema(
          collections({
            name: 'Posts',
            collection: {
              fields: {
                sections: field('repeater', {
                  fields: { title: field('text', { translatable: true }) },
                }),
              },
            },
          }),
          useFields(),
        ),
      bodyMatching(/Mark the top-level composite translatable instead/),
    );
  });

  it('rejects a translatable field inside a block', () => {
    throws(
      () =>
        buildDesiredSchema(
          collections({
            name: 'Pages',
            collection: { fields: { content: field('blocks') } },
          }),
          useFields(),
          blocks({
            name: 'Hero',
            block: { fields: { heading: field('text', { translatable: true }) } },
          }),
        ),
      bodyMatching(/a block's fields are never individually translatable/),
    );
  });

  it('rejects a translatable inverse field: the owning side decides', () => {
    throws(
      () =>
        buildDesiredSchema(
          collections(
            {
              name: 'Posts',
              collection: {
                fields: {
                  authors: field('records', { collection: 'Users' }),
                },
              },
            },
            {
              name: 'Users',
              collection: {
                fields: {
                  posts: {
                    type: 'records',
                    options: { collection: 'Posts', inverse: 'authors', translatable: true },
                  } as unknown as FieldInstance,
                },
              },
            },
          ),
          useFields(),
        ),
      bodyMatching(/the owning field decides translatability/),
    );
  });

  it('rejects `uniquePerLocale` without its companions to narrow', () => {
    throws(
      () =>
        buildDesiredSchema(
          collections({
            name: 'Posts',
            collection: {
              fields: { slug: field('text', { unique: true, uniquePerLocale: true }) },
            },
          }),
          useFields(),
        ),
      bodyMatching(/Set `translatable: true` alongside it/),
    );
    throws(
      () =>
        buildDesiredSchema(
          collections({
            name: 'Posts',
            collection: {
              fields: {
                slug: field('text', { translatable: true, uniquePerLocale: true }),
              },
            },
          }),
          useFields(),
        ),
      bodyMatching(/Set `unique: true` alongside it/),
    );
  });
});

import { deepStrictEqual, strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import type { CollectionMeta } from '../../../../src/ohne/collections/use-collections.ts';
import type { FieldTypeName } from '../../../../src/ohne/fields/known-fields.ts';
import type { FieldTypeMeta } from '../../../../src/ohne/fields/use-fields.ts';

import { buildDesiredSchema } from '../../../../src/ohne/database/schema/desired.ts';
import { defineField } from '../../../../src/ohne/fields/define-field.ts';
import { field, type FieldInstance } from '../../../../src/ohne/fields/field.ts';
import { useFields } from '../../../../src/ohne/fields/use-fields.ts';
import { truncateWithHash } from '../../../../src/utils/crypto/index.ts';
import { createRegistry, type Registry } from '../../../../src/utils/index.ts';

function collections(...metas: CollectionMeta[]): Registry<CollectionMeta> {
  const registry = createRegistry<CollectionMeta>();
  for (const meta of metas) registry.register(meta.name, meta);
  return registry;
}

function fieldsWith(name: string, fieldType: FieldTypeMeta['fieldType']): Registry<FieldTypeMeta> {
  const registry = createRegistry<FieldTypeMeta>();
  registry.register(name, { name: name as FieldTypeName, fieldType });
  return registry;
}

describe('buildDesiredSchema', () => {
  it('emits UUID and _updatedAt on every collection table', () => {
    const [table] = buildDesiredSchema(
      collections({ name: 'Posts', collection: { fields: {} } }),
      useFields(),
    );
    strictEqual(table!.name, 'Posts');
    deepStrictEqual(table!.primaryKey, ['UUID']);
    deepStrictEqual(table!.columns, [
      { name: 'UUID', type: 'text', notNull: true },
      { name: '_updatedAt', type: 'integer', notNull: true },
    ]);
  });

  it('maps each field to a column, nullability following the option', () => {
    const [table] = buildDesiredSchema(
      collections({
        name: 'Posts',
        collection: {
          fields: { title: field('text'), views: field('integer', { nullable: true }) },
        },
      }),
      useFields(),
    );
    deepStrictEqual(table!.columns.slice(2), [
      { name: 'title', type: 'text', notNull: true },
      { name: 'views', type: 'integer', notNull: false },
    ]);
  });

  it('emits a unique constraint for a unique field', () => {
    const [table] = buildDesiredSchema(
      collections({
        name: 'Users',
        collection: { fields: { email: field('text', { unique: true }) } },
      }),
      useFields(),
    );
    deepStrictEqual(table!.uniques, [{ name: 'UX__Users__email', columns: ['email'] }]);
    deepStrictEqual(table!.indexes, []);
  });

  it('emits an index for an indexed field', () => {
    const [table] = buildDesiredSchema(
      collections({
        name: 'Posts',
        collection: { fields: { author: field('text', { index: true }) } },
      }),
      useFields(),
    );
    deepStrictEqual(table!.indexes, [{ name: 'IX__Posts__author', columns: ['author'] }]);
    deepStrictEqual(table!.uniques, []);
  });

  it('builds composite constraints in field order', () => {
    const [table] = buildDesiredSchema(
      collections({
        name: 'Posts',
        collection: {
          fields: {
            status: field('text'),
            createdAt: field('integer'),
            email: field('text'),
            tenantId: field('text'),
          },
          compositeIndexes: [
            { fields: ['email', 'tenantId'], unique: true },
            { fields: ['status', 'createdAt'] },
          ],
        },
      }),
      useFields(),
    );
    deepStrictEqual(table!.uniques, [
      { name: 'UX__Posts__email_tenantId', columns: ['email', 'tenantId'] },
    ]);
    deepStrictEqual(table!.indexes, [
      { name: 'IX__Posts__status_createdAt', columns: ['status', 'createdAt'] },
    ]);
  });

  it('composes constraint names from the logical name, truncating once at the physical boundary', () => {
    const long = `A${'b'.repeat(70)}`;
    const [table] = buildDesiredSchema(
      collections({
        name: long,
        collection: {
          fields: { email: field('text', { unique: true }), status: field('text') },
          compositeIndexes: [{ fields: ['email', 'status'] }],
        },
      }),
      useFields(),
    );
    strictEqual(table!.name, truncateWithHash(long));
    deepStrictEqual(table!.uniques, [
      { name: truncateWithHash(`UX__${long}__email`), columns: ['email'] },
    ]);
    deepStrictEqual(table!.indexes, [
      { name: truncateWithHash(`IX__${long}__email_status`), columns: ['email', 'status'] },
    ]);
  });

  it('rejects an unknown field type, naming the reference', () => {
    throws(
      () =>
        buildDesiredSchema(
          collections({
            name: 'Posts',
            collection: {
              fields: { rel: { type: 'records', options: {} } as unknown as FieldInstance },
            },
          }),
          useFields(),
        ),
      /Unknown field type `records`/,
    );
  });

  it('rejects a composite index over an unknown field', () => {
    throws(
      () =>
        buildDesiredSchema(
          collections({
            name: 'Posts',
            collection: {
              fields: { title: field('text') },
              compositeIndexes: [{ fields: ['title', 'slug'] }],
            },
          }),
          useFields(),
        ),
      /unknown field `slug`/,
    );
  });

  it('rejects a composite index whose field case does not match a declared field', () => {
    throws(
      () =>
        buildDesiredSchema(
          collections({
            name: 'Posts',
            collection: {
              fields: { email: field('text') },
              compositeIndexes: [{ fields: ['Email'] }],
            },
          }),
          useFields(),
        ),
      /unknown field `Email`/,
    );
  });

  it('rejects a single-field composite that collides with a field-level constraint', () => {
    throws(
      () =>
        buildDesiredSchema(
          collections({
            name: 'Posts',
            collection: {
              fields: { email: field('text', { unique: true }) },
              compositeIndexes: [{ fields: ['email'], unique: true }],
            },
          }),
          useFields(),
        ),
      /builds the constraint `UX__Posts__email` twice/,
    );
  });

  it('rejects an explicit nullable:false on a force-nullable field type', () => {
    throws(
      () =>
        buildDesiredSchema(
          collections({
            name: 'Posts',
            collection: {
              fields: {
                ref: { type: 'locked', options: { nullable: false } } as unknown as FieldInstance,
              },
            },
          }),
          fieldsWith('locked', defineField({ columnType: 'text', forceNullable: true })),
        ),
      /Field `ref` cannot be NOT NULL/,
    );
  });

  it('rejects a reserved collection name', () => {
    throws(
      () =>
        buildDesiredSchema(collections({ name: 'Block', collection: { fields: {} } }), useFields()),
      /reserved/,
    );
  });

  it('rejects a reserved field name', () => {
    throws(
      () =>
        buildDesiredSchema(
          collections({ name: 'Posts', collection: { fields: { uuid: field('text') } } }),
          useFields(),
        ),
      /reserved/,
    );
  });

  it('rejects case-insensitively colliding collection names', () => {
    throws(
      () =>
        buildDesiredSchema(
          collections(
            { name: 'Posts', collection: { fields: {} } },
            { name: 'posts', collection: { fields: {} } },
          ),
          useFields(),
        ),
      /collide/,
    );
  });
});

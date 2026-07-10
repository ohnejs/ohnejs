import { deepStrictEqual, match, ok, strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import type { CollectionMeta } from '../../../../src/ohne/collections/use-collections.ts';
import type { FieldTypeName } from '../../../../src/ohne/fields/known-fields.ts';
import type { FieldTypeMeta } from '../../../../src/ohne/fields/use-fields.ts';

import { buildDesiredSchema } from '../../../../src/ohne/database/schema/desired.ts';
import { isOhneError } from '../../../../src/ohne/error/ohne-error.ts';
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

function bodyMatching(pattern: RegExp): (error: unknown) => boolean {
  return (error: unknown) => {
    ok(isOhneError(error));
    match(Array.isArray(error.body) ? error.body.join('\n') : (error.body ?? ''), pattern);
    return true;
  };
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

  it('emits the unique index alone when a field sets unique and index', () => {
    const [table] = buildDesiredSchema(
      collections({
        name: 'Users',
        collection: { fields: { email: field('text', { unique: true, index: true }) } },
      }),
      useFields(),
    );
    deepStrictEqual(table!.uniques, [{ name: 'UX__Users__email', columns: ['email'] }]);
    deepStrictEqual(table!.indexes, []);
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
              fields: { rel: { type: 'gallery', options: {} } as unknown as FieldInstance },
            },
          }),
          useFields(),
        ),
      /Unknown field type `gallery`/,
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

  it('rejects an explicit nullable on a force-nullable field type, either value', () => {
    for (const nullable of [false, true]) {
      throws(
        () =>
          buildDesiredSchema(
            collections({
              name: 'Posts',
              collection: {
                fields: {
                  ref: { type: 'locked', options: { nullable } } as unknown as FieldInstance,
                },
              },
            }),
            fieldsWith('locked', defineField({ columnType: 'text', forceNullable: true })),
          ),
        /Field `ref` cannot set `nullable`/,
      );
    }
  });

  it('rejects an explicit index on a force-index field type, either value', () => {
    for (const index of [false, true]) {
      throws(
        () =>
          buildDesiredSchema(
            collections({
              name: 'Posts',
              collection: {
                fields: {
                  ref: { type: 'pinned', options: { index } } as unknown as FieldInstance,
                },
              },
            }),
            fieldsWith('pinned', defineField({ columnType: 'text', forceIndex: true })),
          ),
        /Field `ref` cannot set `index`/,
      );
    }
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

  it('emits a nullable indexed foreign-key column for a record field', () => {
    const [users, posts] = buildDesiredSchema(
      collections(
        { name: 'Users', collection: { fields: {} } },
        {
          name: 'Posts',
          collection: { fields: { author: field('record', { collection: 'Users' }) } },
        },
      ),
      useFields(),
    );
    strictEqual(users!.name, 'Users');
    deepStrictEqual(posts!.columns.slice(2), [{ name: 'author', type: 'text', notNull: false }]);
    deepStrictEqual(posts!.foreignKeys, [
      { column: 'author', targetTable: 'Users', targetColumn: 'UUID', onDelete: 'setNull' },
    ]);
    deepStrictEqual(posts!.indexes, [{ name: 'IX__Posts__author', columns: ['author'] }]);
  });

  it('upgrades a unique record field to a one-to-one constraint', () => {
    const [, posts] = buildDesiredSchema(
      collections(
        { name: 'Users', collection: { fields: {} } },
        {
          name: 'Posts',
          collection: {
            fields: {
              author: field('record', { collection: 'Users', unique: true, onDelete: 'cascade' }),
            },
          },
        },
      ),
      useFields(),
    );
    deepStrictEqual(posts!.uniques, [{ name: 'UX__Posts__author', columns: ['author'] }]);
    deepStrictEqual(posts!.indexes, []);
    strictEqual(posts!.foreignKeys[0]?.onDelete, 'cascade');
  });

  it('rejects a record referencing an unknown collection, naming the reference', () => {
    throws(
      () =>
        buildDesiredSchema(
          collections({
            name: 'Posts',
            collection: { fields: { author: field('record', { collection: 'Users' }) } },
          }),
          useFields(),
        ),
      /Unknown collection `Users`/,
    );
  });

  it('emits a junction table for an owning records field, nothing on the main table', () => {
    const [users, posts, junction] = buildDesiredSchema(
      collections(
        { name: 'Users', collection: { fields: {} } },
        {
          name: 'Posts',
          collection: { fields: { authors: field('records', { collection: 'Users' }) } },
        },
      ),
      useFields(),
    );
    strictEqual(users!.name, 'Users');
    deepStrictEqual(posts!.columns.slice(2), []);
    strictEqual(junction!.name, 'Posts_authors');
    deepStrictEqual(junction!.primaryKey, []);
    deepStrictEqual(junction!.columns, [
      { name: '_parentUUID', type: 'text', notNull: true },
      { name: '_targetUUID', type: 'text', notNull: true },
      { name: '_parentPosition', type: 'integer', notNull: true },
      { name: '_targetPosition', type: 'integer', notNull: true },
    ]);
    deepStrictEqual(junction!.uniques, [
      {
        name: 'UX__Posts_authors___parentUUID__targetUUID',
        columns: ['_parentUUID', '_targetUUID'],
      },
    ]);
    deepStrictEqual(junction!.indexes, [
      { name: 'IX__Posts_authors___targetUUID', columns: ['_targetUUID'] },
    ]);
    deepStrictEqual(junction!.foreignKeys, [
      { column: '_parentUUID', targetTable: 'Posts', targetColumn: 'UUID', onDelete: 'cascade' },
      { column: '_targetUUID', targetTable: 'Users', targetColumn: 'UUID', onDelete: 'cascade' },
    ]);
  });

  it('propagates a records onDelete to the target side only', () => {
    const [, , junction] = buildDesiredSchema(
      collections(
        { name: 'Users', collection: { fields: {} } },
        {
          name: 'Posts',
          collection: {
            fields: { authors: field('records', { collection: 'Users', onDelete: 'restrict' }) },
          },
        },
      ),
      useFields(),
    );
    deepStrictEqual(
      junction!.foreignKeys.map((foreignKey) => foreignKey.onDelete),
      ['cascade', 'restrict'],
    );
  });

  it('builds a self-referencing junction with both sides aimed at the owner', () => {
    const [, junction] = buildDesiredSchema(
      collections({
        name: 'Posts',
        collection: { fields: { related: field('records', { collection: 'Posts' }) } },
      }),
      useFields(),
    );
    deepStrictEqual(
      junction!.foreignKeys.map((foreignKey) => foreignKey.targetTable),
      ['Posts', 'Posts'],
    );
  });

  it('rejects a records field referencing an unknown collection', () => {
    throws(
      () =>
        buildDesiredSchema(
          collections({
            name: 'Posts',
            collection: { fields: { tags: field('records', { collection: 'Tags' }) } },
          }),
          useFields(),
        ),
      /Unknown collection `Tags`/,
    );
  });

  it('creates one junction for an inverse pair, owned by the declaring side', () => {
    const tables = buildDesiredSchema(
      collections(
        {
          name: 'Users',
          collection: {
            fields: { posts: field('records', { collection: 'Posts', inverse: 'authors' }) },
          },
        },
        {
          name: 'Posts',
          collection: { fields: { authors: field('records', { collection: 'Users' }) } },
        },
      ),
      useFields(),
    );
    deepStrictEqual(
      tables.map((table) => table.name),
      ['Users', 'Posts', 'Posts_authors'],
    );
  });

  it('rejects an inverse naming a missing field on the target', () => {
    throws(
      () =>
        buildDesiredSchema(
          collections(
            {
              name: 'Users',
              collection: {
                fields: { posts: field('records', { collection: 'Posts', inverse: 'writers' }) },
              },
            },
            { name: 'Posts', collection: { fields: {} } },
          ),
          useFields(),
        ),
      /Unknown inverse field `writers`/,
    );
  });

  it('rejects an inverse naming a field that owns no junction', () => {
    throws(
      () =>
        buildDesiredSchema(
          collections(
            {
              name: 'Users',
              collection: {
                fields: { posts: field('records', { collection: 'Posts', inverse: 'title' }) },
              },
            },
            { name: 'Posts', collection: { fields: { title: field('text') } } },
          ),
          useFields(),
        ),
      /Field `title` cannot be an inverse target/,
    );
  });

  it('rejects an inverse whose owning field relates to another collection', () => {
    throws(
      () =>
        buildDesiredSchema(
          collections(
            {
              name: 'Users',
              collection: {
                fields: { posts: field('records', { collection: 'Posts', inverse: 'tags' }) },
              },
            },
            {
              name: 'Posts',
              collection: { fields: { tags: field('records', { collection: 'Tags' }) } },
            },
            { name: 'Tags', collection: { fields: {} } },
          ),
          useFields(),
        ),
      /Inverse field `tags` points elsewhere/,
    );
  });

  it('rejects two fields declaring inverse at each other', () => {
    throws(
      () =>
        buildDesiredSchema(
          collections(
            {
              name: 'Users',
              collection: {
                fields: { posts: field('records', { collection: 'Posts', inverse: 'authors' }) },
              },
            },
            {
              name: 'Posts',
              collection: {
                fields: { authors: field('records', { collection: 'Users', inverse: 'posts' }) },
              },
            },
          ),
          useFields(),
        ),
      /both declare `inverse`/,
    );
  });

  it('rejects a field declaring itself as its inverse', () => {
    throws(
      () =>
        buildDesiredSchema(
          collections({
            name: 'Users',
            collection: {
              fields: { friends: field('records', { collection: 'Users', inverse: 'friends' }) },
            },
          }),
          useFields(),
        ),
      /Field `friends` declares itself as its inverse/,
    );
  });

  it('pairs a self-referencing relation through a second field', () => {
    const tables = buildDesiredSchema(
      collections({
        name: 'Users',
        collection: {
          fields: {
            buddies: field('records', { collection: 'Users' }),
            friends: field('records', { collection: 'Users', inverse: 'buddies' }),
          },
        },
      }),
      useFields(),
    );
    deepStrictEqual(
      tables.map((table) => table.name),
      ['Users', 'Users_buddies'],
    );
  });

  it('rejects an inverse field configuring onDelete', () => {
    throws(
      () =>
        buildDesiredSchema(
          collections(
            {
              name: 'Users',
              collection: {
                fields: {
                  posts: {
                    type: 'records',
                    options: { collection: 'Posts', inverse: 'authors', onDelete: 'restrict' },
                  } as unknown as FieldInstance,
                },
              },
            },
            {
              name: 'Posts',
              collection: { fields: { authors: field('records', { collection: 'Users' }) } },
            },
          ),
          useFields(),
        ),
      /Field `posts` cannot set `onDelete`/,
    );
  });

  it('rejects unique, index, and nullable on a records field', () => {
    for (const [key, message] of [
      ['unique', /Field `tags` has no column to constrain/],
      ['index', /Field `tags` has no column to constrain/],
      ['nullable', /Field `tags` cannot be nullable/],
    ] as const) {
      throws(
        () =>
          buildDesiredSchema(
            collections(
              {
                name: 'Posts',
                collection: {
                  fields: {
                    tags: {
                      type: 'records',
                      options: { collection: 'Tags', [key]: true },
                    } as unknown as FieldInstance,
                  },
                },
              },
              { name: 'Tags', collection: { fields: {} } },
            ),
            useFields(),
          ),
        message,
      );
    }
  });

  it('rejects a composite index covering a records field', () => {
    throws(
      () =>
        buildDesiredSchema(
          collections(
            {
              name: 'Posts',
              collection: {
                fields: { title: field('text'), tags: field('records', { collection: 'Tags' }) },
                compositeIndexes: [{ fields: ['title', 'tags'] }],
              },
            },
            { name: 'Tags', collection: { fields: {} } },
          ),
          useFields(),
        ),
      /Composite index covers column-less field `tags`/,
    );
  });

  it('rejects a column-less field type that declares no schema', () => {
    throws(
      () =>
        buildDesiredSchema(
          collections({
            name: 'Posts',
            collection: {
              fields: { gallery: { type: 'empty', options: {} } as unknown as FieldInstance },
            },
          }),
          fieldsWith('empty', defineField({ columnType: false })),
        ),
      /owns no column and no storage/,
    );
  });

  it('rejects a foreign-key hint on a non-text column type', () => {
    throws(
      () =>
        buildDesiredSchema(
          collections(
            {
              name: 'Posts',
              collection: {
                fields: { author: { type: 'intRef', options: {} } as unknown as FieldInstance },
              },
            },
            { name: 'Users', collection: { fields: {} } },
          ),
          fieldsWith(
            'intRef',
            defineField({
              columnType: 'integer',
              schema: () => ({ kind: 'foreignKey', collection: 'Users' }),
            }),
          ),
        ),
      /pairs a foreign key with `integer`/,
    );
  });

  it('rejects a junction hint on a column-bearing type', () => {
    throws(
      () =>
        buildDesiredSchema(
          collections(
            {
              name: 'Posts',
              collection: {
                fields: { tags: { type: 'textJunction', options: {} } as unknown as FieldInstance },
              },
            },
            { name: 'Tags', collection: { fields: {} } },
          ),
          fieldsWith(
            'textJunction',
            defineField({
              columnType: 'text',
              schema: () => ({ kind: 'junction', collection: 'Tags' }),
            }),
          ),
        ),
      /pairs a junction with a column/,
    );
  });

  it('truncates a long junction name once, constraints composing from the logical name', () => {
    const long = `A${'b'.repeat(70)}`;
    const [, junction] = buildDesiredSchema(
      collections({
        name: long,
        collection: { fields: { related: field('records', { collection: long }) } },
      }),
      useFields(),
    );
    strictEqual(junction!.name, truncateWithHash(`${long}_related`));
    deepStrictEqual(junction!.uniques, [
      {
        name: truncateWithHash(`UX__${long}_related___parentUUID__targetUUID`),
        columns: ['_parentUUID', '_targetUUID'],
      },
    ]);
  });

  it('emits a child table for an object field, nothing on the main table', () => {
    const [posts, child] = buildDesiredSchema(
      collections({
        name: 'Posts',
        collection: {
          fields: {
            address: field('object', {
              fields: { street: field('text'), city: field('text', { nullable: true }) },
            }),
          },
        },
      }),
      useFields(),
    );
    deepStrictEqual(posts!.columns.slice(2), []);
    strictEqual(child!.name, 'Posts_address');
    deepStrictEqual(child!.primaryKey, ['UUID']);
    deepStrictEqual(child!.columns, [
      { name: 'UUID', type: 'text', notNull: true },
      { name: '_parentUUID', type: 'text', notNull: true },
      { name: 'street', type: 'text', notNull: true },
      { name: 'city', type: 'text', notNull: false },
    ]);
    deepStrictEqual(child!.uniques, [
      { name: 'UX__Posts_address___parentUUID', columns: ['_parentUUID'] },
    ]);
    deepStrictEqual(child!.indexes, []);
    deepStrictEqual(child!.foreignKeys, [
      { column: '_parentUUID', targetTable: 'Posts', targetColumn: 'UUID', onDelete: 'cascade' },
    ]);
    deepStrictEqual(child!.derived, {
      collection: 'Posts',
      path: ['address'],
      kind: 'childOne',
    });
  });

  it('emits an ordered child table for a repeater field', () => {
    const [, child] = buildDesiredSchema(
      collections({
        name: 'Posts',
        collection: {
          fields: { sections: field('repeater', { fields: { title: field('text') } }) },
        },
      }),
      useFields(),
    );
    strictEqual(child!.name, 'Posts_sections');
    deepStrictEqual(child!.primaryKey, ['UUID']);
    deepStrictEqual(child!.columns, [
      { name: 'UUID', type: 'text', notNull: true },
      { name: '_parentUUID', type: 'text', notNull: true },
      { name: '_parentPosition', type: 'integer', notNull: true },
      { name: 'title', type: 'text', notNull: true },
    ]);
    deepStrictEqual(child!.uniques, []);
    deepStrictEqual(child!.indexes, [
      { name: 'IX__Posts_sections___parentUUID', columns: ['_parentUUID'] },
    ]);
    deepStrictEqual(child!.derived, {
      collection: 'Posts',
      path: ['sections'],
      kind: 'childMany',
    });
  });

  it('nests composites, each level deriving its own child table depth-first', () => {
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
            }),
          },
        },
      }),
      useFields(),
    );
    deepStrictEqual(
      tables.map((table) => table.name),
      ['Posts', 'Posts_sections', 'Posts_sections_items'],
    );
    const items = tables[2]!;
    deepStrictEqual(items.foreignKeys, [
      {
        column: '_parentUUID',
        targetTable: 'Posts_sections',
        targetColumn: 'UUID',
        onDelete: 'cascade',
      },
    ]);
    deepStrictEqual(items.indexes, [
      { name: 'IX__Posts_sections_items___parentUUID', columns: ['_parentUUID'] },
    ]);
    deepStrictEqual(items.derived, {
      collection: 'Posts',
      path: ['sections', 'items'],
      kind: 'childMany',
    });
  });

  it('attaches subfield constraints and record foreign keys to the child table', () => {
    const [, , child] = buildDesiredSchema(
      collections(
        { name: 'Users', collection: { fields: {} } },
        {
          name: 'Posts',
          collection: {
            fields: {
              meta: field('object', {
                fields: {
                  email: field('text', { unique: true }),
                  author: field('record', { collection: 'Users' }),
                },
              }),
            },
          },
        },
      ),
      useFields(),
    );
    strictEqual(child!.name, 'Posts_meta');
    deepStrictEqual(child!.columns.slice(2), [
      { name: 'email', type: 'text', notNull: true },
      { name: 'author', type: 'text', notNull: false },
    ]);
    deepStrictEqual(child!.uniques, [
      { name: 'UX__Posts_meta___parentUUID', columns: ['_parentUUID'] },
      { name: 'UX__Posts_meta__email', columns: ['email'] },
    ]);
    deepStrictEqual(child!.indexes, [{ name: 'IX__Posts_meta__author', columns: ['author'] }]);
    deepStrictEqual(child!.foreignKeys, [
      { column: '_parentUUID', targetTable: 'Posts', targetColumn: 'UUID', onDelete: 'cascade' },
      { column: 'author', targetTable: 'Users', targetColumn: 'UUID', onDelete: 'setNull' },
    ]);
  });

  it('derives a junction from a nested records field, hung off the child table', () => {
    const tables = buildDesiredSchema(
      collections(
        { name: 'Users', collection: { fields: {} } },
        {
          name: 'Posts',
          collection: {
            fields: {
              sections: field('repeater', {
                fields: {
                  title: field('text'),
                  tags: field('records', { collection: 'Users' }),
                },
              }),
            },
          },
        },
      ),
      useFields(),
    );
    deepStrictEqual(
      tables.map((table) => table.name),
      ['Users', 'Posts', 'Posts_sections', 'Posts_sections_tags'],
    );
    const junction = tables[3]!;
    deepStrictEqual(junction.foreignKeys, [
      {
        column: '_parentUUID',
        targetTable: 'Posts_sections',
        targetColumn: 'UUID',
        onDelete: 'cascade',
      },
      { column: '_targetUUID', targetTable: 'Users', targetColumn: 'UUID', onDelete: 'cascade' },
    ]);
    deepStrictEqual(junction.derived, {
      collection: 'Posts',
      path: ['sections', 'tags'],
      kind: 'junction',
    });
  });

  it('rejects an inverse on a nested records field', () => {
    throws(
      () =>
        buildDesiredSchema(
          collections(
            { name: 'Users', collection: { fields: {} } },
            {
              name: 'Posts',
              collection: {
                fields: {
                  sections: field('repeater', {
                    fields: { tags: field('records', { collection: 'Users', inverse: 'posts' }) },
                  }),
                },
              },
            },
          ),
          useFields(),
        ),
      /Field `sections\.tags` cannot declare `inverse`/,
    );
  });

  it('rejects a composite declaring no fields', () => {
    throws(
      () =>
        buildDesiredSchema(
          collections({
            name: 'Posts',
            collection: { fields: { meta: field('object', { fields: {} }) } },
          }),
          useFields(),
        ),
      /Composite field `meta` declares no fields/,
    );
  });

  it('rejects nullable on a composite, the message following the cardinality', () => {
    const cases = [
      { type: 'object', pattern: /absent row already reads as `null`/ },
      { type: 'repeater', pattern: /empty, never `NULL`/ },
    ];
    for (const { type, pattern } of cases) {
      throws(
        () =>
          buildDesiredSchema(
            collections({
              name: 'Posts',
              collection: {
                fields: {
                  meta: {
                    type,
                    options: { fields: { x: field('text') }, nullable: true },
                  } as unknown as FieldInstance,
                },
              },
            }),
            useFields(),
          ),
        bodyMatching(pattern),
      );
    }
  });

  it('rejects unique and index on a composite field', () => {
    for (const key of ['unique', 'index']) {
      throws(
        () =>
          buildDesiredSchema(
            collections({
              name: 'Posts',
              collection: {
                fields: {
                  meta: {
                    type: 'object',
                    options: { fields: { x: field('text') }, [key]: true },
                  } as unknown as FieldInstance,
                },
              },
            }),
            useFields(),
          ),
        /no column to constrain/,
      );
    }
  });

  it('rejects a child hint on a column-bearing type', () => {
    throws(
      () =>
        buildDesiredSchema(
          collections({
            name: 'Posts',
            collection: {
              fields: { meta: { type: 'broken', options: {} } as unknown as FieldInstance },
            },
          }),
          fieldsWith(
            'broken',
            defineField({
              columnType: 'text',
              schema: () => ({
                kind: 'child',
                cardinality: 'one',
                subfields: { x: field('text') },
              }),
            }),
          ),
        ),
      /pairs a child table with a column/,
    );
  });

  it('rejects a subfield name that is not camelCase, naming the composite scope', () => {
    throws(
      () =>
        buildDesiredSchema(
          collections({
            name: 'Posts',
            collection: {
              fields: { address: field('object', { fields: { Street: field('text') } }) },
            },
          }),
          useFields(),
        ),
      bodyMatching(/Rename `Street` in `Posts\.address`/),
    );
  });

  it('rejects case-insensitively colliding subfield names', () => {
    throws(
      () =>
        buildDesiredSchema(
          collections({
            name: 'Posts',
            collection: {
              fields: {
                address: field('object', {
                  fields: { itemId: field('text'), itemID: field('text') },
                }),
              },
            },
          }),
          useFields(),
        ),
      /Field names `itemId` and `itemID` collide/,
    );
  });

  it('rejects a reserved subfield name', () => {
    throws(
      () =>
        buildDesiredSchema(
          collections({
            name: 'Posts',
            collection: {
              fields: { address: field('object', { fields: { uuid: field('text') } }) },
            },
          }),
          useFields(),
        ),
      /reserved/,
    );
  });

  it('rejects a composite index covering an object field', () => {
    throws(
      () =>
        buildDesiredSchema(
          collections({
            name: 'Posts',
            collection: {
              fields: { address: field('object', { fields: { street: field('text') } }) },
              compositeIndexes: [{ fields: ['address'] }],
            },
          }),
          useFields(),
        ),
      /Composite index covers column-less field `address`/,
    );
  });

  it('truncates a long child name once, constraints composing from the logical name', () => {
    const long = `A${'b'.repeat(70)}`;
    const [, child] = buildDesiredSchema(
      collections({
        name: long,
        collection: {
          fields: { address: field('object', { fields: { street: field('text') } }) },
        },
      }),
      useFields(),
    );
    strictEqual(child!.name, truncateWithHash(`${long}_address`));
    deepStrictEqual(child!.uniques, [
      {
        name: truncateWithHash(`UX__${long}_address___parentUUID`),
        columns: ['_parentUUID'],
      },
    ]);
  });
});

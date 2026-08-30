import { deepStrictEqual, doesNotThrow, match, ok, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { defineCollection } from '../../../src/ohne/collections/define-collection.ts';
import { isOhneError } from '../../../src/ohne/error/ohne-error.ts';
import { field } from '../../../src/ohne/fields/field.ts';

describe('defineCollection', () => {
  it('returns a valid definition unchanged', () => {
    const definition = { fields: { title: field('text') } };
    deepStrictEqual(defineCollection(definition), definition);
  });

  it('rejects a non-camelCase field name', () => {
    throws(() => defineCollection({ fields: { created_at: field('text') } }), /camelCase/);
  });

  it('accepts a compositeIndexes entry over declared fields', () => {
    const definition = defineCollection({
      fields: { email: field('text'), tenantId: field('text') },
      compositeIndexes: [{ fields: ['email', 'tenantId'], unique: true }],
    });
    deepStrictEqual(definition.compositeIndexes, [{ fields: ['email', 'tenantId'], unique: true }]);
  });

  it('rejects a compositeIndexes field that is not declared', () => {
    throws(
      () =>
        defineCollection({
          fields: { title: field('text') },
          // @ts-expect-error `slug` is not a field of this collection
          compositeIndexes: [{ fields: ['title', 'slug'] }],
        }),
      /unknown field `slug`/,
    );
  });

  it('rejects a compositeIndexes entry with no fields', () => {
    throws(
      () =>
        defineCollection({ fields: { title: field('text') }, compositeIndexes: [{ fields: [] }] }),
      /covers no fields/,
    );
  });

  it('rejects a compositeIndexes entry that repeats a field', () => {
    throws(
      () =>
        defineCollection({
          fields: { title: field('text') },
          compositeIndexes: [{ fields: ['title', 'title'] }],
        }),
      /repeats field `title`/,
    );
  });

  it('rejects two identical compositeIndexes entries', () => {
    throws(
      () =>
        defineCollection({
          fields: { a: field('text'), b: field('text') },
          compositeIndexes: [{ fields: ['a', 'b'] }, { fields: ['a', 'b'] }],
        }),
      /Duplicate composite index/,
    );
  });

  it('allows the same fields in a different order or uniqueness', () => {
    doesNotThrow(() =>
      defineCollection({
        fields: { a: field('text'), b: field('text') },
        compositeIndexes: [
          { fields: ['a', 'b'] },
          { fields: ['b', 'a'] },
          { fields: ['a', 'b'], unique: true },
        ],
      }),
    );
  });

  it('accepts api as a boolean or omitted', () => {
    doesNotThrow(() => defineCollection({ fields: { title: field('text') }, api: true }));
    doesNotThrow(() => defineCollection({ fields: { title: field('text') }, api: false }));
    doesNotThrow(() => defineCollection({ fields: { title: field('text') } }));
  });

  it('accepts a per-operation api table', () => {
    doesNotThrow(() =>
      defineCollection({
        fields: { title: field('text') },
        api: { read: true, create: { middleware: ['x'] } },
      }),
    );
  });

  it('accepts public operations in both spellings', () => {
    doesNotThrow(() =>
      defineCollection({
        fields: { title: field('text') },
        api: { read: 'public', create: { public: true, middleware: ['x'] } },
      }),
    );
  });

  it('rejects a non-boolean public flag', () => {
    throws(
      () =>
        defineCollection({
          fields: { title: field('text') },
          // @ts-expect-error `public` must be a boolean
          api: { read: { public: 'yes' } },
        }),
      /Invalid `api` operation `read`/,
    );
  });

  it('rejects a string operation other than `public`', () => {
    throws(
      () =>
        defineCollection({
          fields: { title: field('text') },
          // @ts-expect-error only `'public'` is a legal string operation
          api: { read: 'open' },
        }),
      /Invalid `api` operation `read`/,
    );
  });

  it('rejects a non-boolean non-object api', () => {
    throws(
      () =>
        defineCollection({
          fields: { title: field('text') },
          // @ts-expect-error `api` is neither a boolean nor an object
          api: 'yes',
        }),
      /Invalid `api` exposure/,
    );
  });

  it('rejects an unknown api operation', () => {
    throws(
      () =>
        defineCollection({
          fields: { title: field('text') },
          // @ts-expect-error `publish` is not an operation
          api: { publish: true },
        }),
      /Unknown `api` operation `publish`/,
    );
  });

  it('rejects a middleware that is not an array', () => {
    throws(
      () =>
        defineCollection({
          fields: { title: field('text') },
          // @ts-expect-error `middleware` must be an array
          api: { create: { middleware: 'x' } },
        }),
      /Invalid `api` operation `create`/,
    );
  });

  it('rejects a middleware entry that is not a string', () => {
    throws(
      () =>
        defineCollection({
          fields: { title: field('text') },
          // @ts-expect-error `middleware` entries must be strings
          api: { create: { middleware: [1] } },
        }),
      /Invalid `api` operation `create`/,
    );
  });

  it('rejects an operation with an unknown key', () => {
    throws(
      () =>
        defineCollection({
          fields: { title: field('text') },
          // @ts-expect-error `other` is not an endpoint option
          api: { create: { other: true } },
        }),
      /Invalid `api` operation `create`/,
    );
  });

  it('rejects a null operation', () => {
    throws(
      () =>
        defineCollection({
          fields: { title: field('text') },
          // @ts-expect-error an operation cannot be `null`
          api: { create: null },
        }),
      /Invalid `api` operation `create`/,
    );
  });

  it('accepts an icon the vendored set carries', () => {
    doesNotThrow(() => defineCollection({ fields: { title: field('text') }, icon: 'note' }));
    doesNotThrow(() =>
      defineCollection({ fields: { title: field('text') }, icon: 'brand-github' }),
    );
  });

  it('rejects an icon the set does not carry, suggesting the nearest name', () => {
    throws(
      () =>
        defineCollection({
          fields: { title: field('text') },
          // @ts-expect-error `notez` is not an icon name
          icon: 'notez',
        }),
      (error: unknown) => {
        ok(isOhneError(error));
        match(error.title ?? '', /Unknown icon `notez`/);
        match([error.body].flat().join('\n'), /Did you mean `note`\?/);
        return true;
      },
    );
  });

  it('points at the icon set when nothing is close', () => {
    throws(
      () =>
        defineCollection({
          fields: { title: field('text') },
          // @ts-expect-error `qqqqqqqqqqqq` is not an icon name
          icon: 'qqqqqqqqqqqq',
        }),
      (error: unknown) => {
        ok(isOhneError(error));
        match([error.body].flat().join('\n'), /tabler\.io\/icons/);
        return true;
      },
    );
  });

  it('does not take an inherited name for an icon', () => {
    throws(
      () =>
        defineCollection({
          fields: { title: field('text') },
          // @ts-expect-error `constructor` is not an icon name
          icon: 'constructor',
        }),
      /Unknown icon `constructor`/,
    );
  });

  it('accepts a recordLabel field name and list unchanged', () => {
    const single = defineCollection({ fields: { title: field('text') }, recordLabel: 'title' });
    deepStrictEqual(single.recordLabel, 'title');
    const listed = defineCollection({
      fields: { firstName: field('text'), lastName: field('text') },
      recordLabel: ['firstName', 'lastName'],
    });
    deepStrictEqual(listed.recordLabel, ['firstName', 'lastName']);
  });

  it('rejects a recordLabel naming an unknown field', () => {
    throws(
      () =>
        defineCollection({
          fields: { title: field('text') },
          // @ts-expect-error `titel` is not a field of this collection
          recordLabel: ['titel'],
        }),
      /unknown field `titel`/,
    );
  });

  it('rejects an empty recordLabel list', () => {
    throws(
      () => defineCollection({ fields: { title: field('text') }, recordLabel: [] }),
      /list is empty/,
    );
  });

  it('rejects a recordLabel repeating a field', () => {
    throws(
      () => defineCollection({ fields: { title: field('text') }, recordLabel: ['title', 'title'] }),
      /repeats field `title`/,
    );
  });

  it('rejects a recordLabel naming a write-only field', () => {
    throws(
      () =>
        defineCollection({
          fields: { title: field('text'), secret: field('text', { readable: false }) },
          recordLabel: ['secret'],
        }),
      /write-only field `secret`/,
    );
  });

  it('rejects a recordLabel naming a non-text field', () => {
    throws(
      () => defineCollection({ fields: { views: field('integer') }, recordLabel: ['views'] }),
      /non-text field `views`/,
    );
  });

  it('rejects a recordLabel naming a relation', () => {
    throws(
      () =>
        defineCollection({
          fields: { owner: field('record', { collection: 'Users' }) },
          recordLabel: ['owner'],
        }),
      /non-text field `owner`/,
    );
  });

  it('rejects a recordLabel of more than ten fields', () => {
    throws(
      () =>
        defineCollection({
          fields: {
            a: field('text'),
            b: field('text'),
            c: field('text'),
            d: field('text'),
            e: field('text'),
            f: field('text'),
            g: field('text'),
            h: field('text'),
            i: field('text'),
            j: field('text'),
            k: field('text'),
          },
          recordLabel: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'],
        }),
      /more than ten fields/,
    );
  });

  it('rejects a non-string recordLabel', () => {
    throws(
      () =>
        defineCollection({
          fields: { title: field('text') },
          // @ts-expect-error a recordLabel is a field name or an array of them
          recordLabel: 42,
        }),
      /Invalid `recordLabel` declaration/,
    );
  });

  it('accepts table columns in both spellings and returns them unchanged', () => {
    const definition = defineCollection({
      fields: { title: field('text'), views: field('integer') },
      table: { columns: ['title | 20rem', 'views|20rem', '_updatedAt'] },
    });
    deepStrictEqual(definition.table, { columns: ['title | 20rem', 'views|20rem', '_updatedAt'] });
  });

  it('rejects a table column naming an unknown field', () => {
    throws(
      () =>
        defineCollection({
          fields: { title: field('text') },
          // @ts-expect-error `slug` is not a field of this collection
          table: { columns: ['slug'] },
        }),
      /unknown field `slug`/,
    );
  });

  it('rejects a table column repeating a field', () => {
    throws(
      () =>
        defineCollection({
          fields: { title: field('text') },
          table: { columns: ['title', 'title|20rem'] },
        }),
      /repeats field `title`/,
    );
  });

  it('rejects a table column entry naming no field', () => {
    throws(
      () =>
        defineCollection({
          fields: { title: field('text') },
          // @ts-expect-error an entry must start with a field name
          table: { columns: [' | 20rem'] },
        }),
      /names no field/,
    );
  });

  it('rejects an empty table columns list', () => {
    throws(
      () => defineCollection({ fields: { title: field('text') }, table: { columns: [] } }),
      /is empty/,
    );
  });

  it('rejects a non-string table column entry', () => {
    throws(
      () =>
        defineCollection({
          fields: { title: field('text') },
          // @ts-expect-error an entry must be a string
          table: { columns: [42] },
        }),
      /Invalid `table.columns`/,
    );
  });

  it('rejects a table column naming a write-only field', () => {
    throws(
      () =>
        defineCollection({
          fields: { title: field('text'), secret: field('text', { readable: false }) },
          table: { columns: ['secret'] },
        }),
      /write-only field `secret`/,
    );
  });

  it('accepts plain CSS lengths and rejects any other width', () => {
    doesNotThrow(() =>
      defineCollection({
        fields: { title: field('text'), views: field('integer') },
        table: { columns: ['title | 50%', 'views|300px|12.5rem'] },
      }),
    );
    throws(
      () =>
        defineCollection({
          fields: { title: field('text') },
          table: { columns: ['title | calc(100% - 2rem)'] },
        }),
      /Invalid `table.columns` width/,
    );
  });
});

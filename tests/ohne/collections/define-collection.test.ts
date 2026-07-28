import { deepStrictEqual, doesNotThrow, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { defineCollection } from '../../../src/ohne/collections/define-collection.ts';
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
});

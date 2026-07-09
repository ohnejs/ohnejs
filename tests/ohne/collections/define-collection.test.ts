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
});

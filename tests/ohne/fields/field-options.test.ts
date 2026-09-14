import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { defineField } from '../../../src/ohne/fields/define-field.ts';
import { field } from '../../../src/ohne/fields/field.ts';
import { option } from '../../../src/ohne/fields/option.ts';

const fixtureField = defineField({
  columnType: 'text',
  options: {
    /**
     * To.
     */
    to: option<string>({ required: true }),

    /**
     * Limit.
     *
     * @default
     * 10
     */
    limit: option({ default: 10 }),
  },
});

const fixtureIndexed = defineField({ columnType: 'text', forceIndex: true });

const fixtureLinked = defineField({ columnType: false });

declare module 'ohnejs' {
  interface KnownFields {
    fixtureField: typeof fixtureField;
    fixtureIndexed: typeof fixtureIndexed;
    fixtureLinked: typeof fixtureLinked;
  }
}

describe('field over a field type with declared options', () => {
  it('requires the options argument when the type has a required option', () => {
    // @ts-expect-error `fixtureField` declares a required `to` option
    field('fixtureField');

    // @ts-expect-error `to` is required
    field('fixtureField', { limit: 5 });

    field('fixtureField', { to: 'Users' });
    field('fixtureField', { to: 'Users', limit: 5, unique: true });
  });

  it('rejects an option the field type does not declare', () => {
    // @ts-expect-error `nope` is not an option of `fixtureField`
    field('fixtureField', { to: 'Users', nope: 1 });
  });

  it('types the instance default as the field type storage primitive, callback ctx included', () => {
    field('text', { default: 'draft' });
    field('text', { default: null });
    field('integer', { default: 0 });
    field('fixtureField', {
      to: 'Users',
      default: (ctx) => {
        const limit: number = ctx.options.limit;
        const operation: 'create' | 'update' = ctx.operation;
        return `${limit}${operation}`;
      },
    });

    // @ts-expect-error a number is not a text default
    field('text', { default: 5 });
  });

  it('types an instance validator/sanitizer value and ctx.options', () => {
    field('fixtureField', {
      to: 'Users',
      sanitizers: [(value, ctx) => (ctx.options.limit > 0 ? value.trim() : value)],
      validators: [
        (value, ctx) => {
          const length: number = value.length; // value is `string`, the text primitive
          const to: string = ctx.options.to;
          const limit: number = ctx.options.limit;
          const nullable: boolean = ctx.options.nullable;
          // @ts-expect-error `nope` is neither a declared nor a common option
          const nope: unknown = ctx.options.nope;
          return `${length}${to}${limit}${nullable}${nope}`.length === 0 ? 'x' : undefined;
        },
      ],
    });
  });

  it('stores the type name and options at runtime', () => {
    deepStrictEqual(field('fixtureField', { to: 'Users' }), {
      type: 'fixtureField',
      options: { to: 'Users' },
    });
  });
});

describe('field over a field type with forced flags', () => {
  it('hides the options the forced flags lock', () => {
    field('record', { collection: 'Users' });
    field('record', { collection: 'Users', unique: true });

    // @ts-expect-error `record` locks the column nullable
    field('record', { collection: 'Users', nullable: true });

    // @ts-expect-error `record` locks its index
    field('record', { collection: 'Users', index: true });
  });

  it('keeps `nullable` and `unique` on a force-indexed type', () => {
    field('fixtureIndexed', { nullable: true, unique: true });

    // @ts-expect-error `fixtureIndexed` locks its index
    field('fixtureIndexed', { index: true });
  });
});

describe('field over a column-less field type', () => {
  it('takes only `translatable` of the common options', () => {
    field('fixtureLinked');
    field('fixtureLinked', { translatable: true });

    // @ts-expect-error a column-less field has no column to constrain
    field('fixtureLinked', { unique: true });

    // @ts-expect-error a column-less field has no column to constrain
    field('fixtureLinked', { index: true });

    // @ts-expect-error a column-less field has no column to constrain
    field('fixtureLinked', { uniquePerLocale: true });

    // @ts-expect-error a column-less field has no column to be nullable
    field('fixtureLinked', { nullable: true });
  });

  it('narrows `records` to its call-site shape', () => {
    field('records', { collection: 'Users', inverse: 'authors' });
    field('records', { collection: 'Users', onDelete: 'restrict', translatable: true });

    // @ts-expect-error a `records` field owns no column to constrain
    field('records', { collection: 'Users', unique: true });

    // @ts-expect-error a junction field is never `NULL`
    field('records', { collection: 'Users', nullable: true });

    // @ts-expect-error the owning side configures `onDelete`
    field('records', { collection: 'Users', inverse: 'authors', onDelete: 'restrict' });

    // @ts-expect-error an inverse field follows the owning side's junction
    field('records', { collection: 'Users', inverse: 'authors', translatable: true });
  });

  it('requires the subfields of a composite, barring the common options', () => {
    // @ts-expect-error `object` requires its `fields` option
    field('object');

    // @ts-expect-error `repeater` requires its `fields` option
    field('repeater');

    field('object', { fields: { street: field('text') } });
    field('repeater', { fields: { title: field('text', { unique: true }) } });
    field('repeater', {
      fields: { nested: field('object', { fields: { deep: field('integer') } }) },
    });

    // @ts-expect-error a composite field has no column to constrain
    field('object', { fields: { street: field('text') }, unique: true });

    // @ts-expect-error an absent object row already reads as `null`
    field('object', { fields: { street: field('text') }, nullable: true });

    // @ts-expect-error a repeater with no items is empty, never `NULL`
    field('repeater', { fields: { title: field('text') }, nullable: true });
  });
});

describe('field with per-locale options', () => {
  it('keeps `translatable` on every kind, column-less included', () => {
    field('text', { translatable: true });
    field('record', { collection: 'Users', translatable: true });
    field('records', { collection: 'Users', translatable: true });
    field('object', { fields: { street: field('text') }, translatable: true });
    field('repeater', { fields: { title: field('text') }, translatable: true });
    field('blocks', { translatable: true });
  });

  it('keeps `uniquePerLocale` beside `unique` on a column-bearing field', () => {
    field('text', { unique: true, translatable: true, uniquePerLocale: true });

    // @ts-expect-error a composite field has no column to constrain
    field('object', { fields: { street: field('text') }, uniquePerLocale: true });

    // @ts-expect-error a `records` field owns no column to constrain
    field('records', { collection: 'Users', uniquePerLocale: true });
  });

  it('keeps `uniquePerParent` beside `unique` on a column-bearing field', () => {
    field('text', { unique: true, uniquePerParent: true });

    // @ts-expect-error a composite field has no column to constrain
    field('repeater', { fields: { title: field('text') }, uniquePerParent: true });

    // @ts-expect-error a `records` field owns no column to constrain
    field('records', { collection: 'Users', uniquePerParent: true });
  });
});

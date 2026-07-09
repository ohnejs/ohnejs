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

declare module 'ohne' {
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
  it('takes no common options', () => {
    field('fixtureLinked');

    // @ts-expect-error a column-less field has no column to constrain
    field('fixtureLinked', { unique: true });

    // @ts-expect-error a column-less field has no column to constrain
    field('fixtureLinked', { index: true });

    // @ts-expect-error a column-less field has no column to be nullable
    field('fixtureLinked', { nullable: true });
  });

  it('narrows `records` to its call-site shape', () => {
    field('records', { collection: 'Users', inverse: 'authors' });

    // @ts-expect-error a `records` field owns no column to constrain
    field('records', { collection: 'Users', unique: true });

    // @ts-expect-error a junction field is never `NULL`
    field('records', { collection: 'Users', nullable: true });
  });
});

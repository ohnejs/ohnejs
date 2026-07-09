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
     * @default 10
     */
    limit: option({ default: 10 }),
  },
});

declare module 'ohne' {
  interface KnownFields {
    fixtureField: typeof fixtureField;
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

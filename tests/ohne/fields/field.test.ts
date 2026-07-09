import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { defineField } from '../../../src/ohne/fields/define-field.ts';
import { field, resolveFieldOptions } from '../../../src/ohne/fields/field.ts';
import { option } from '../../../src/ohne/fields/option.ts';

describe('field', () => {
  it('tags an instance with its type and options', () => {
    deepStrictEqual(field('text'), { type: 'text', options: {} });
    deepStrictEqual(field('integer', { index: true }), {
      type: 'integer',
      options: { index: true },
    });
  });
});

describe('resolveFieldOptions', () => {
  const bounded = defineField({
    columnType: 'text',
    options: {
      max: option({ default: 10 }),
      placeholder: option<string>(),
    },
  });

  it('fills the common defaults when nothing is passed', () => {
    deepStrictEqual(resolveFieldOptions(defineField({ columnType: 'text' }), {}), {
      nullable: false,
      unique: false,
      index: false,
    });
  });

  it('keeps a passed common option over its default', () => {
    deepStrictEqual(resolveFieldOptions(defineField({ columnType: 'text' }), { nullable: true }), {
      nullable: true,
      unique: false,
      index: false,
    });
  });

  it('fills a declared default and keeps a default-less option absent', () => {
    deepStrictEqual(resolveFieldOptions(bounded, {}), {
      nullable: false,
      unique: false,
      index: false,
      max: 10,
    });
  });

  it('keeps a passed declared value over its default', () => {
    deepStrictEqual(resolveFieldOptions(bounded, { max: 5, placeholder: 'name' }), {
      nullable: false,
      unique: false,
      index: false,
      max: 5,
      placeholder: 'name',
    });
  });

  it('treats an explicit undefined as absent and keeps the default', () => {
    deepStrictEqual(resolveFieldOptions(bounded, { nullable: undefined, max: undefined }), {
      nullable: false,
      unique: false,
      index: false,
      max: 10,
    });
  });

  it('resolves nullable to true for a force-nullable field type', () => {
    const locked = defineField({ columnType: 'text', forceNullable: true });
    deepStrictEqual(resolveFieldOptions(locked, {}), {
      nullable: true,
      unique: false,
      index: false,
    });
  });
});

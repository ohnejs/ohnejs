import { deepStrictEqual, strictEqual } from 'node:assert';
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
      pattern: option<string>(),
    },
  });

  it('fills the common defaults when nothing is passed', () => {
    deepStrictEqual(resolveFieldOptions(defineField({ columnType: 'text' }), {}), {
      nullable: false,
      unique: false,
      index: false,
      translatable: false,
      uniquePerLocale: false,
      uniquePerParent: false,
      readable: true,
      writable: true,
      immutable: false,
    });
  });

  it('keeps a passed common option over its default', () => {
    deepStrictEqual(resolveFieldOptions(defineField({ columnType: 'text' }), { nullable: true }), {
      nullable: true,
      unique: false,
      index: false,
      translatable: false,
      uniquePerLocale: false,
      uniquePerParent: false,
      readable: true,
      writable: true,
      immutable: false,
    });
  });

  it('fills a declared default and keeps a default-less option absent', () => {
    deepStrictEqual(resolveFieldOptions(bounded, {}), {
      nullable: false,
      unique: false,
      index: false,
      translatable: false,
      uniquePerLocale: false,
      uniquePerParent: false,
      readable: true,
      writable: true,
      immutable: false,
      max: 10,
    });
  });

  it('keeps a passed declared value over its default', () => {
    deepStrictEqual(resolveFieldOptions(bounded, { max: 5, pattern: 'name' }), {
      nullable: false,
      unique: false,
      index: false,
      translatable: false,
      uniquePerLocale: false,
      uniquePerParent: false,
      readable: true,
      writable: true,
      immutable: false,
      max: 5,
      pattern: 'name',
    });
  });

  it('treats an explicit undefined as absent and keeps the default', () => {
    deepStrictEqual(resolveFieldOptions(bounded, { nullable: undefined, max: undefined }), {
      nullable: false,
      unique: false,
      index: false,
      translatable: false,
      uniquePerLocale: false,
      uniquePerParent: false,
      readable: true,
      writable: true,
      immutable: false,
      max: 10,
    });
  });

  it('resolves nullable to true for a force-nullable field type', () => {
    const locked = defineField({ columnType: 'text', forceNullable: true });
    deepStrictEqual(resolveFieldOptions(locked, {}), {
      nullable: true,
      unique: false,
      index: false,
      translatable: false,
      uniquePerLocale: false,
      uniquePerParent: false,
      readable: true,
      writable: true,
      immutable: false,
    });
  });

  it('carries the value options through, presence-tracked for `default`', () => {
    const clean = (value: unknown) => value;
    const resolved = resolveFieldOptions(defineField({ columnType: 'text' }), {
      default: null,
      sanitizers: [clean],
    });
    strictEqual('default' in resolved, true);
    strictEqual(resolved.default, null);
    deepStrictEqual(resolved.sanitizers, [clean]);
    strictEqual('validators' in resolved, false);
  });

  it('treats an explicit undefined default as absent', () => {
    const resolved = resolveFieldOptions(defineField({ columnType: 'text' }), {
      default: undefined,
    });
    strictEqual('default' in resolved, false);
  });
});

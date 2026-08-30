import { deepStrictEqual, strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { defineField } from '../../../src/ohne/fields/define-field.ts';
import { option } from '../../../src/ohne/fields/option.ts';

describe('defineField', () => {
  it('returns a column-bearing definition unchanged', () => {
    deepStrictEqual(defineField({ columnType: 'text', forceIndex: true }), {
      columnType: 'text',
      forceIndex: true,
    });
  });

  it('accepts a column-less type without column options', () => {
    deepStrictEqual(defineField({ columnType: false }), { columnType: false });
  });

  it('rejects `forceNullable` on a column-less type', () => {
    throws(() => defineField({ columnType: false, forceNullable: true }), /column-less/);
  });

  it('rejects `forceIndex` on a column-less type', () => {
    throws(() => defineField({ columnType: false, forceIndex: true }), /column-less/);
  });

  it('accepts camelCase, non-reserved option names', () => {
    deepStrictEqual(
      defineField({ columnType: 'text', options: { maxLength: option({ default: 255 }) } }),
      {
        columnType: 'text',
        options: { maxLength: { required: false, default: 255 } },
      },
    );
  });

  it('rejects a non-camelCase option name', () => {
    throws(
      () => defineField({ columnType: 'text', options: { max_length: option() } }),
      /`max_length` is not camelCase/,
    );
  });

  it('rejects an option name that shadows a common option', () => {
    throws(
      () => defineField({ columnType: 'text', options: { unique: option() } }),
      /`unique` is reserved/,
    );
  });

  it('rejects an option name that shadows a value option', () => {
    for (const name of ['default', 'sanitizers', 'validators']) {
      throws(
        () => defineField({ columnType: 'text', options: { [name]: option() } }),
        new RegExp(`\`${name}\` is reserved`),
      );
    }
  });

  it('rejects an option name that shadows a presentation option', () => {
    for (const name of ['label', 'description']) {
      throws(
        () => defineField({ columnType: 'text', options: { [name]: option() } }),
        new RegExp(`\`${name}\` is reserved`),
      );
    }
  });

  it('rejects `sanitizers` or `validators` that are not arrays of functions', () => {
    throws(
      () => defineField({ columnType: 'text', sanitizers: 'nope' as never }),
      /`sanitizers` must be an array of functions/,
    );
    throws(
      () => defineField({ columnType: 'text', validators: [42 as never] }),
      /`validators` must be an array of functions/,
    );
  });

  it('types sanitizer and validator value as the column primitive', () => {
    const def = defineField({
      columnType: 'text',
      sanitizers: [(value) => value.trim()],
      validators: [(value) => (value.length > 280 ? 'too long' : undefined)],
    });
    strictEqual(typeof def.sanitizers?.[0], 'function');

    defineField({
      columnType: 'integer',
      validators: [(value) => (value < 0 ? 'negative' : undefined)],
    });

    // @ts-expect-error a text sanitizer must return a string, not a number
    defineField({ columnType: 'text', sanitizers: [(value) => Number(value)] });
  });

  it('types defaultValue as the column storage primitive, callback ctx included', () => {
    defineField({ columnType: 'text', defaultValue: 'draft' });
    defineField({ columnType: 'integer', defaultValue: 0 });
    defineField({ columnType: 'real', defaultValue: 0.5 });
    defineField({ columnType: 'boolean', defaultValue: false });
    defineField({ columnType: 'text', defaultValue: null });
    defineField({
      columnType: 'text',
      options: { max: option({ default: 10 }) },
      defaultValue: (ctx) => {
        const max: number = ctx.options.max;
        const operation: 'create' | 'update' = ctx.operation;
        const title: unknown = ctx.input.title;
        return `${max}${operation}${String(title)}`;
      },
    });

    // @ts-expect-error a number is not a text default
    defineField({ columnType: 'text', defaultValue: 5 });
  });

  it('keeps an emitType callback on the definition', () => {
    const emitType = () => 'string';
    strictEqual(defineField({ columnType: 'text', emitType }).emitType, emitType);
  });

  it('rejects declaring both `schema` and `emitType`', () => {
    throws(
      () =>
        defineField({
          columnType: 'text',
          schema: () => ({ kind: 'foreignKey', collection: 'Users' }),
          emitType: () => 'string',
        }),
      /cannot declare both `schema` and `emitType`/,
    );
  });

  it('types emitType ctx with fully resolved options - defaults required, no-default keys optional', () => {
    const def = defineField({
      columnType: 'text',
      options: {
        choices: option<string[]>({ required: true }),
        max: option({ default: 10 }),
        pattern: option<string>(),
      },
      emitType: (ctx) => {
        const choices: string[] = ctx.options.choices;
        const max: number = ctx.options.max;
        const pattern: string | undefined = ctx.options.pattern;
        const nullable: boolean = ctx.options.nullable;
        const label = ctx.importType('./geo.ts', 'LatLng');
        // @ts-expect-error `nope` is neither a declared nor a common option
        const nope: unknown = ctx.options.nope;
        return `${label}${choices.length}${max}${pattern}${nullable}${nope}`;
      },
    });
    strictEqual(def.columnType, 'text');
  });
});

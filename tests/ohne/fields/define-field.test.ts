import { deepStrictEqual, strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { defineField } from '../../../src/ohne/fields/define-field.ts';
import { option } from '../../../src/ohne/fields/option.ts';

describe('defineField', () => {
  it('returns a column-bearing definition unchanged', () => {
    deepStrictEqual(defineField({ columnType: 'text', index: true }), {
      columnType: 'text',
      index: true,
    });
  });

  it('accepts a column-less type without column options', () => {
    deepStrictEqual(defineField({ columnType: false }), { columnType: false });
  });

  it('rejects `forceNullable` on a column-less type', () => {
    throws(() => defineField({ columnType: false, forceNullable: true }), /column-less/);
  });

  it('rejects `index` on a column-less type', () => {
    throws(() => defineField({ columnType: false, index: true }), /column-less/);
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

  it('keeps an emitType callback on the definition', () => {
    const emitType = () => 'string';
    strictEqual(defineField({ columnType: 'text', emitType }).emitType, emitType);
  });

  it('types emitType ctx with fully resolved options - defaults required, no-default keys optional', () => {
    const def = defineField({
      columnType: 'text',
      options: {
        choices: option<string[]>({ required: true }),
        max: option({ default: 10 }),
        placeholder: option<string>(),
      },
      emitType: (ctx) => {
        const choices: string[] = ctx.options.choices;
        const max: number = ctx.options.max;
        const placeholder: string | undefined = ctx.options.placeholder;
        const nullable: boolean = ctx.options.nullable;
        const label = ctx.importType('./geo.ts', 'LatLng');
        // @ts-expect-error `nope` is neither a declared nor a common option
        const nope: unknown = ctx.options.nope;
        return `${label}${choices.length}${max}${placeholder}${nullable}${nope}`;
      },
    });
    strictEqual(def.columnType, 'text');
  });
});

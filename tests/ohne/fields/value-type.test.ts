import { deepStrictEqual, strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import type { FieldType } from '../../../src/ohne/fields/define-field.ts';
import type { AnyOptionDef } from '../../../src/ohne/fields/option.ts';

import { defineField } from '../../../src/ohne/fields/define-field.ts';
import { field } from '../../../src/ohne/fields/field.ts';
import { option } from '../../../src/ohne/fields/option.ts';
import { fieldValueType } from '../../../src/ohne/fields/value-type.ts';
import { createTypeImports } from '../../../src/utils/codegen/index.ts';

const emit = <T extends Record<string, AnyOptionDef>>(
  fieldType: FieldType<T>,
  options: Record<string, unknown> = {},
) => {
  const imports = createTypeImports('/app/.ohne');
  const type = fieldValueType({
    fieldType,
    name: 'field',
    options,
    fieldDir: '/app/fields',
    imports,
  });
  return { type, imports };
};

describe('fieldValueType', () => {
  it('falls back to the JS type of the column when no emitType is declared', () => {
    strictEqual(emit(defineField({ columnType: 'text' })).type, 'string');
    strictEqual(emit(defineField({ columnType: 'integer' })).type, 'number');
    strictEqual(emit(defineField({ columnType: 'real' })).type, 'number');
    strictEqual(emit(defineField({ columnType: 'boolean' })).type, 'boolean');
  });

  it('wraps a nullable field with `| null`', () => {
    strictEqual(
      emit(defineField({ columnType: 'text' }), { nullable: true }).type,
      'string | null',
    );
  });

  it('wraps a forceNullable field type even without instance nullable', () => {
    strictEqual(
      emit(defineField({ columnType: 'text', forceNullable: true })).type,
      'string | null',
    );
  });

  it('runs emitType and returns its value type', () => {
    const select = defineField({
      columnType: 'text',
      options: { choices: option<string[]>({ required: true }) },
      emitType: (ctx) => ctx.options.choices.map((c) => `'${c}'`).join(' | '),
    });
    strictEqual(emit(select, { choices: ['a', 'b'] }).type, "'a' | 'b'");
    strictEqual(emit(select, { choices: ['a', 'b'], nullable: true }).type, "'a' | 'b' | null");
  });

  it('resolves the common options and exposes them to emitType', () => {
    const flag = defineField({
      columnType: 'text',
      emitType: (ctx) => (ctx.options.unique ? "'unique'" : "'plain'"),
    });
    strictEqual(emit(flag, { unique: true }).type, "'unique'");
    strictEqual(emit(flag).type, "'plain'");
  });

  it('importGenerated references a file beside the generated output', () => {
    const generated = defineField({
      columnType: 'json',
      emitType: (ctx) => `${ctx.importGenerated('roles.ts', 'GeneratedRoleName')}[]`,
    });
    const { type, imports } = emit(generated);
    strictEqual(type, 'GeneratedRoleName[]');
    deepStrictEqual(imports.statements(), ["import type { GeneratedRoleName } from './roles.ts';"]);
  });

  it('rejects an emitType import of a program entry', () => {
    const node = defineField({
      columnType: 'json',
      emitType: (ctx) => ctx.importType('ohne', 'RoleName'),
    });
    throws(() => emit(node), /Browser-unsafe type import/);

    const browser = defineField({
      columnType: 'json',
      emitType: (ctx) => ctx.importType('ohne/dashboard', 'KnownMessages'),
    });
    throws(() => emit(browser), /Browser-unsafe type import/);
  });

  it('joins a multiline emitType returning string[] with newlines', () => {
    const point = defineField({
      columnType: 'text',
      emitType: () => ['{', '  lat: number', '  lng: number', '}'],
    });
    strictEqual(emit(point).type, '{\n  lat: number\n  lng: number\n}');
    strictEqual(emit(point, { nullable: true }).type, '{\n  lat: number\n  lng: number\n} | null');
  });

  it('resolves declared-option defaults before reaching emitType', () => {
    const bounded = defineField({
      columnType: 'integer',
      options: { max: option({ default: 10 }) },
      emitType: (ctx) => `${ctx.options.max}`,
    });
    strictEqual(emit(bounded).type, '10');
    strictEqual(emit(bounded, { max: 5 }).type, '5');
  });

  it('records importType references and returns the local name', () => {
    const geo = defineField({
      columnType: 'text',
      emitType: (ctx) => ctx.importType('./geo.ts', 'LatLng'),
    });
    const { type, imports } = emit(geo);
    strictEqual(type, 'LatLng');
    deepStrictEqual(imports.statements(), ["import type { LatLng } from '../fields/geo.ts';"]);
  });

  it('throws for a column-less field type without a storage hint', () => {
    throws(() => emit(defineField({ columnType: false })), /column-less/);
  });

  it('emits an ordered UUID array for a junction field', () => {
    const junction = defineField({
      columnType: false,
      schema: () => ({ kind: 'junction', collection: 'Users' }),
    });
    strictEqual(emit(junction).type, 'string[]');
  });

  it('throws for a child hint, whose shape assembles at codegen instead', () => {
    const composite = defineField({
      columnType: false,
      schema: () => ({ kind: 'child', cardinality: 'one', subfields: { x: field('text') } }),
    });
    throws(() => emit(composite), /column-less/);
  });

  it('wraps a force-nullable foreign-key field with null', () => {
    const reference = defineField({
      columnType: 'text',
      forceNullable: true,
      schema: () => ({ kind: 'foreignKey', collection: 'Users' }),
    });
    strictEqual(emit(reference).type, 'string | null');
  });
});

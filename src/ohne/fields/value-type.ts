import type { TypeImports } from '../../utils/codegen/type-imports.ts';
import type { LogicalType } from '../database/dialect.ts';
import type { EmitTypeContext } from './context.ts';
import type { FieldType } from './define-field.ts';
import type { AnyOptionDef } from './option.ts';

import { isArray } from '../../utils/index.ts';
import { ohneError } from '../error/ohne-error.ts';
import { resolveFieldOptions } from './field.ts';

/**
 * Arguments to `fieldValueType`.
 */
export interface FieldValueTypeArgs<TOptions extends Record<string, AnyOptionDef>> {
  /**
   * The registered field type whose value type is being emitted.
   */
  fieldType: FieldType<TOptions>;

  /**
   * The field's key in its collection, exposed to `emitType` as `ctx.name`.
   */
  name: string;

  /**
   * The instance options passed to `field(...)` - the type's own options plus the common ones.
   */
  options: Record<string, unknown>;

  /**
   * The directory of the field type's own file, against which `importType` resolves relative paths.
   */
  fieldDir: string;

  /**
   * The import collector for the file being generated; `importType` records into it.
   */
  imports: TypeImports;
}

/**
 * The TypeScript value type a column-bearing field falls back to when it declares no `emitType`.
 */
const FALLBACK: Record<LogicalType, string> = {
  text: 'string',
  integer: 'number',
  boolean: 'boolean',
  json: 'unknown',
};

/**
 * One field's value type split into its non-null base and whether the field admits `null`.
 * The generated read shape wants `base | null`; the query metadata wants the base and the flag apart.
 */
export interface FieldBaseType {
  /**
   * The value type without any `| null`, exactly as `emitType` (or the fallback) produced it.
   */
  base: string;

  /**
   * Whether the field's value shape admits `null` (instance `nullable` or type `forceNullable`).
   */
  nullable: boolean;
}

/**
 * Emits one field's non-null base type and its nullability, the shared core of the value-type emitters.
 *
 * Runs the field type's `emitType` when it declares one, otherwise falls back from `columnType`.
 * The type's own options are resolved with their defaults before reaching `emitType` as `ctx.options`.
 * An `emitType` returning `string[]` is joined with `\n`, so a multiline type comes back as one string.
 *
 * A column-less field derives its type from its storage hint.
 * A junction holds the linked rows' `UUID` values in order, so its base is `string[]`, never null.
 * A child hint is assembled from its subfields at codegen, where the registered types are at hand.
 * It therefore throws here, as does a column-less type without a hint.
 *
 * @example
 * ```ts
 * fieldBaseType({ fieldType: text, name: 'title', options: { nullable: true }, fieldDir, imports })
 * // -> { base: 'string', nullable: true }
 * ```
 */
export function fieldBaseType<TOptions extends Record<string, AnyOptionDef>>(
  args: FieldValueTypeArgs<TOptions>,
): FieldBaseType {
  const { fieldType, name, options, fieldDir, imports } = args;
  const resolved = resolveFieldOptions(fieldType, options);

  if (fieldType.columnType === false) {
    const hint = fieldType.schema?.({ name, options: resolved });
    if (hint?.kind === 'junction') return { base: 'string[]', nullable: false };
    throw ohneError({
      title: 'Cannot emit a type for a column-less field',
      body: [
        'A column-less field type (`columnType: false`) owns no column, so it has no value type to emit.',
        "A junction emits `string[]`; a composite's shape is assembled from its subfields at codegen.",
      ],
    });
  }

  const ctx: EmitTypeContext<TOptions> = {
    name,
    options: resolved,
    importType: (path, exportName) => imports.reference({ fromDir: fieldDir, path, exportName }),
  };

  const emitted = fieldType.emitType ? fieldType.emitType(ctx) : FALLBACK[fieldType.columnType];
  const base = isArray(emitted) ? emitted.join('\n') : emitted;
  return { base, nullable: resolved.nullable };
}

/**
 * Emits one field's TypeScript value type as a source string, `| null` folded in when nullable.
 *
 * The read-shape emitter: a nullable field comes back as `base | null`, everything else as its base.
 * This is the value type only; the caller assembles the surrounding property and indents each line.
 *
 * @example
 * ```ts
 * fieldValueType({ fieldType: text, name: 'title', options: {}, fieldDir, imports })
 * // -> 'string'
 *
 * fieldValueType({ fieldType: text, name: 'title', options: { nullable: true }, fieldDir, imports })
 * // -> 'string | null'
 * ```
 */
export function fieldValueType<TOptions extends Record<string, AnyOptionDef>>(
  args: FieldValueTypeArgs<TOptions>,
): string {
  const { base, nullable } = fieldBaseType(args);
  return nullable ? `${base} | null` : base;
}

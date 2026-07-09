import type { LogicalType } from '../database/dialect.ts';
import type { EmitTypeContext, FieldContext } from './context.ts';
import type { AnyOptionDef } from './option.ts';
import type { StorageHint } from './storage-hint.ts';

import { validateFieldType } from './validate-field.ts';

/**
 * A field type: the reusable storage contract every `field(...)` instance is built from.
 *
 * These members define how the field's value is stored.
 * The built-ins ship in core and register at module load; layers add their own under `dirs.fields`.
 * `TOptions` captures the options this type declares, so `field('<name>', ...)` narrows to them.
 * `TColumn` keeps the `columnType` literal, so column-less types stay distinguishable at the type level.
 * `TForceNullable` and `TForceIndex` keep the forced flags, so `field(...)` hides the options they lock.
 */
export interface FieldType<
  TOptions extends Record<string, AnyOptionDef> = Record<string, AnyOptionDef>,
  TColumn extends LogicalType | false = LogicalType | false,
  TForceNullable extends boolean = boolean,
  TForceIndex extends boolean = boolean,
> {
  /**
   * The storage primitive of the field's own column, or `false` when the field owns no column.
   */
  columnType: TColumn;

  /**
   * Locks the column NULL-permitting; a field of this type takes no `nullable` at all.
   * Column-bearing types only.
   * A `record` sets it: its target can be deleted out from under the column.
   *
   * @default
   * false
   */
  forceNullable?: TForceNullable;

  /**
   * Locks a non-unique index onto the field's column.
   * Column-bearing types only.
   * A field of this type takes no `index`; `unique: true` upgrades the forced index to a unique one.
   *
   * @default
   * false
   */
  forceIndex?: TForceIndex;

  /**
   * The options this field type accepts, each declared with `option()`.
   * Names are camelCase and may not shadow a common option (`nullable`, `unique`, `index`, etc.).
   *
   * @example
   * ```ts
   * options: {
   *   max: option({ default: 255 }),
   *   collection: option<string>({ required: true }),
   * }
   * ```
   */
  options?: TOptions;

  /**
   * Returns the storage layout of a field that needs more than a plain column.
   *
   * - A `record` pairs `columnType: 'text'` with a `foreignKey` hint.
   * - A `records` pairs `columnType: false` with a `junction` hint.
   *
   * Runs when the desired schema builds and at codegen time, never inside a request.
   * `ctx` carries the field's name and its resolved options.
   * Mutually exclusive with `emitType`: the framework derives the value type from the hint.
   */
  schema?(ctx: FieldContext<TOptions>): StorageHint;

  /**
   * Emits the field's TypeScript value type as source, run at codegen time.
   *
   * Return only the value type (`'string'`, `'number[]'`, `"'a' | 'b'"`).
   * A multiline type may return an array of lines instead of one `\n`-joined string.
   * The framework wraps `| null` for a nullable field, and indents each line at the emission site.
   * `ctx` carries the resolved `options` and `importType`.
   *
   * When omitted, the shape falls back from `columnType`:
   * - `text` -> `string`
   * - `integer` -> `number`
   * - `boolean` -> `boolean`
   * - `json` -> `unknown`.
   *
   * Declared as a method, so a concrete field type stays assignable to the registry's wide `FieldType`.
   *
   * @example
   * ```ts
   * emitType: () => 'string'
   * emitType: (ctx) => ctx.options.choices.map((c) => `'${c}'`).join(' | ')
   * emitType: (ctx) => ctx.importType('./_geo.ts', 'LatLng')
   * ```
   */
  emitType?(ctx: EmitTypeContext<TOptions>): string | string[];
}

/**
 * Defines a field type.
 *
 * Default-export the result from a file under a layer's `dirs.fields`.
 * The file names the field type: `fields/slug.ts` becomes `slug`.
 *
 * @example
 * ```ts
 * // fields/slug.ts
 * import { defineField } from 'ohne'
 *
 * export default defineField({ columnType: 'text' })
 * ```
 */
export function defineField<
  TOptions extends Record<string, AnyOptionDef> = {},
  TColumn extends LogicalType | false = LogicalType | false,
  TForceNullable extends boolean = boolean,
  TForceIndex extends boolean = boolean,
>(
  type: FieldType<TOptions, TColumn, TForceNullable, TForceIndex>,
): FieldType<TOptions, TColumn, TForceNullable, TForceIndex> {
  validateFieldType(type);
  return type;
}

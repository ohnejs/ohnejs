import type { LogicalType } from '../database/dialect.ts';
import type { EmitTypeContext } from './context.ts';
import type { AnyOptionDef } from './option.ts';

import { validateFieldType } from './validate-field.ts';

/**
 * A field type: the reusable storage contract every `field(...)` instance is built from.
 *
 * These members define how the field's value is stored.
 * The built-ins ship in core and register at module load; layers add their own under `dirs.fields`.
 * `TOptions` captures the options this type declares, so `field('<name>', ...)` narrows to them.
 */
export interface FieldType<
  TOptions extends Record<string, AnyOptionDef> = Record<string, AnyOptionDef>,
> {
  /**
   * The storage primitive of the field's own column, or `false` when the field owns no column.
   */
  columnType: LogicalType | false;

  /**
   * Locks the column NULL-permitting regardless of the instance `nullable`.
   * Column-bearing types only.
   * A `record` sets it: its target can be deleted out from under the column.
   *
   * @default
   * false
   */
  forceNullable?: boolean;

  /**
   * Forces a non-unique index on the field's column regardless of the instance `index`.
   * Column-bearing types only.
   *
   * @default
   * false
   */
  index?: boolean;

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
export function defineField<TOptions extends Record<string, AnyOptionDef> = {}>(
  type: FieldType<TOptions>,
): FieldType<TOptions> {
  validateFieldType(type);
  return type;
}

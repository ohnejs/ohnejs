import type { FieldType } from './define-field.ts';
import type { FieldTypeName, KnownFields } from './known-fields.ts';
import type { AnyOptionDef, HasRequiredOption, ResolveOptions, ResolvedOptions } from './option.ts';

import { isUndefined } from '../../utils/index.ts';
import { validateFieldInstance } from './validate-field-instance.ts';

/**
 * The storage options every field accepts.
 */
export interface FieldOptions {
  /**
   * Whether the column permits `NULL`.
   *
   * Omitted, it resolves to `false`.
   * A force-nullable field type resolves it to `true` instead, and rejects an explicit `false`.
   */
  nullable?: boolean;

  /**
   * Emits a unique constraint over the field's column.
   * Mutually exclusive with `index`.
   *
   * @default
   * false
   */
  unique?: boolean;

  /**
   * Emits a non-unique index over the field's column.
   * Mutually exclusive with `unique`.
   *
   * @default
   * false
   */
  index?: boolean;
}

/**
 * The common options after resolution: keys in `FIELD_OPTION_DEFAULTS` are required, the rest stay `?:`.
 * The framework fills those defaults, so a resolved field reads them directly, without a fallback.
 */
export type ResolvedFieldOptions = Omit<FieldOptions, keyof typeof FIELD_OPTION_DEFAULTS> &
  Required<Pick<FieldOptions, keyof typeof FIELD_OPTION_DEFAULTS>>;

/**
 * The options field type `K` declares via `defineField({ options })`.
 */
type DeclaredOptions<K extends FieldTypeName> =
  KnownFields[K] extends FieldType<infer O> ? O : Record<string, never>;

/**
 * The full options object `field('K', ...)` accepts: the type's own options plus the common ones.
 */
type InstanceOptions<K extends FieldTypeName> = ResolveOptions<DeclaredOptions<K>> & FieldOptions;

/**
 * One field instance: the field-type name and options from a `field(...)` call.
 */
export interface FieldInstance<K extends FieldTypeName = FieldTypeName> {
  /**
   * The field-type name passed to `field()`.
   */
  type: K;

  /**
   * The options passed to `field()`, alongside the field type's own.
   */
  options: InstanceOptions<K>;
}

/**
 * The default values for the common field options - the single source of truth the resolver fills from.
 */
const FIELD_OPTION_DEFAULTS = {
  nullable: false,
  unique: false,
  index: false,
} satisfies Partial<FieldOptions>;

/**
 * Builds a field instance from a field-type name.
 *
 * `type` is a built-in field type, or one a layer added under `dirs.fields`.
 * You reference it by name, so a collection file imports only `field`, never the field-type module.
 * The options argument is required when the field type declares a required option, optional otherwise.
 *
 * @example
 * ```ts
 * field('text')                   // a plain text field
 * field('text', { unique: true }) // a unique text field
 * ```
 */
export function field<K extends FieldTypeName>(
  type: K,
  ...args: HasRequiredOption<DeclaredOptions<K>> extends true
    ? [options: InstanceOptions<K>]
    : [options?: InstanceOptions<K>]
): FieldInstance<K> {
  const options = (args[0] ?? {}) as InstanceOptions<K>;
  const instance: FieldInstance<K> = { type, options };
  validateFieldInstance(instance);
  return instance;
}

/**
 * Resolves a field instance's options, so a reader never re-applies a default.
 *
 * Starts from the common defaults (`FIELD_OPTION_DEFAULTS`) and each declared `option()` default.
 * A value the caller passed then wins; an explicit `undefined` counts as absent and keeps the default.
 * A force-nullable field type resolves `nullable` to `true`, whatever was passed.
 * A required option and any option with a default land in the result; a default-less option stays absent.
 *
 * @example
 * ```ts
 * resolveFieldOptions(text, { nullable: true })
 * // -> { nullable: true, unique: false, index: false, ... }
 * ```
 */
export function resolveFieldOptions<TOptions extends Record<string, AnyOptionDef>>(
  fieldType: FieldType<TOptions>,
  options: Record<string, unknown>,
): ResolvedOptions<TOptions> & ResolvedFieldOptions {
  const resolved: Record<string, unknown> = { ...FIELD_OPTION_DEFAULTS };
  for (const [key, def] of Object.entries(fieldType.options ?? {})) {
    if (!isUndefined(def.default)) resolved[key] = def.default;
  }
  for (const [key, value] of Object.entries(options)) {
    if (!isUndefined(value)) resolved[key] = value;
  }
  if (fieldType.forceNullable === true) resolved.nullable = true;
  return resolved as ResolvedOptions<TOptions> & ResolvedFieldOptions;
}

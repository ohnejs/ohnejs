import type { ConditionObject } from '../../utils/index.ts';
import type { Message } from '../messages/known-messages.ts';
import type { ColumnValue, FieldDefault, FieldSanitizer, FieldValidator } from './context.ts';
import type { FieldType } from './define-field.ts';
import type { KnownFieldOptions } from './known-field-options.ts';
import type { FieldTypeName, KnownFields } from './known-fields.ts';
import type { AnyOptionDef, ResolveOptions, ResolvedOptions } from './option.ts';

import { isUndefined } from '../../utils/index.ts';

/**
 * The storage options every field accepts.
 */
export interface FieldOptions {
  /**
   * Whether the column permits `NULL`.
   *
   * @default
   * false
   */
  nullable?: boolean;

  /**
   * Emits a unique index over the field's column.
   * The constraint covers the whole table the column lands in, wherever the field sits.
   * Inside a repeater that is every item of every parent row; `uniquePerParent` narrows it to one list.
   * Inside a block it is every instance of the block, database-wide.
   * Set together with `index`, the unique index alone is emitted: it serves plain lookups too.
   *
   * @default
   * false
   */
  unique?: boolean;

  /**
   * Emits a non-unique index over the field's column.
   * Set together with `unique`, it yields to the unique index.
   *
   * @default
   * false
   */
  index?: boolean;

  /**
   * Routes the field to per-locale storage, so each content locale holds its own value.
   * A column-bearing field moves its column to the collection's `__translations` companion.
   * A composite or relation field scopes its own derived table by locale instead.
   * Top-level collection fields only: a composite is per-locale as a whole, never per subfield.
   *
   * @default
   * false
   */
  translatable?: boolean;

  /**
   * Scopes the field's `unique` to one locale, so a value may repeat across locales.
   * Requires `unique` and `translatable`; the index then covers `(_localeCode, <column>)`.
   *
   * @default
   * false
   */
  uniquePerLocale?: boolean;

  /**
   * Scopes the field's `unique` to one parent's item list, so a value may repeat across parents.
   * Requires `unique` and a place inside a repeater; the index then covers `(_parentUUID, <column>)`.
   * In a translatable repeater a list is per (parent, locale), so the index widens over both.
   *
   * @default
   * false
   */
  uniquePerParent?: boolean;
}

/**
 * The value-behaviour options every field instance accepts, whatever its storage kind.
 * They sit outside the column gate, so a column-less relation or composite carries them too.
 * `TOptions` is the field type's own declared options, so an instance callback's `ctx.options` carries them.
 * `TValue` is the field's storage primitive, the type its `default` value must satisfy.
 */
export interface ValueOptions<
  TOptions extends Record<string, AnyOptionDef> = Record<string, AnyOptionDef>,
  TValue = unknown,
> {
  /**
   * A value to store when this field is left out of a create.
   * Pass the value, or a function to compute it - the function can read the record's other input.
   * A relation or composite (`records`/`object`/`repeater`) default must be a function, never a literal.
   *
   * @example
   * ```ts
   * field('text', { default: 'draft' })
   * field('integer', { default: () => Date.now() })
   * ```
   */
  default?: FieldDefault<TValue, TOptions>;

  /**
   * Functions that clean this field's value before it is stored, run in order.
   * Each takes the value and returns a cleaned one; use them to normalise, not to reject.
   *
   * @example
   * ```ts
   * field('text', { sanitizers: [(value) => value.trim().toLowerCase()] })
   * ```
   */
  sanitizers?: readonly FieldSanitizer<TOptions, TValue>[];

  /**
   * Functions that reject this field's value, run in order.
   * Return a message to reject, or nothing to accept; the first message wins.
   * A message is a plain string, a message key, or a `[key, params]` tuple for a parameterized message.
   *
   * @example
   * ```ts
   * field('text', {
   *   validators: [
   *     (value) => (value === '' ? 'This field is required' : undefined),
   *     (value) => (value.length > 10 ? ['field.max', { max: 10 }] : undefined),
   *   ],
   * })
   * ```
   */
  validators?: readonly FieldValidator<TOptions, TValue>[];

  /**
   * A condition that decides whether this field is active for a record, in the condition object form.
   * An inactive field (the condition is false) drops its input, `null` included.
   * A create then takes the default path, and an update leaves the column untouched.
   * Paths resolve in the field's own scope; `/` anchors at the record root, `../` climbs one level.
   * Dots descend into a composite (`address.city`).
   * A gated field must be nullable or carry a default, since an inactive create still needs a value.
   *
   * @example
   * ```ts
   * field('text', { nullable: true, when: { kind: 'discounted' } })
   *
   * field('integer', {
   *   nullable: true,
   *   when: { published: true, views: { atLeast: 100 } },
   * })
   * ```
   */
  when?: ConditionObject;
}

/**
 * The presentation metadata every field instance accepts, shown for the field in the dashboard.
 * They sit outside the column gate, so every field kind - relations and composites included - carries them.
 */
export interface PresentationOptions {
  /**
   * A short label for this field, shown in the dashboard.
   * Pass a message key to translate it per the viewer's language.
   * A `[key, params]` tuple supplies a parameterized message; a plain string is shown as-is.
   * Omitted, the field name is sentence-cased: `gallerySlider` becomes `Gallery slider`.
   */
  label?: Message;

  /**
   * A longer description for this field, shown in the dashboard beneath its label.
   * Markdown is supported.
   * Pass a message key to translate it per the viewer's language.
   * A `[key, params]` tuple supplies a parameterized message; a plain string is shown as-is.
   */
  description?: Message;
}

/**
 * The common options after resolution: keys in `FIELD_OPTION_DEFAULTS` are required, the rest stay `?:`.
 * The framework fills those defaults, so a resolved field reads them directly, without a fallback.
 * The value options join here so a resolved field carries its `default`, `sanitizers`, and `validators`.
 * The presentation options join too, so a resolved field carries its `label` and `description`.
 */
export type ResolvedFieldOptions = Omit<FieldOptions, keyof typeof FIELD_OPTION_DEFAULTS> &
  Required<Pick<FieldOptions, keyof typeof FIELD_OPTION_DEFAULTS>> &
  ValueOptions &
  PresentationOptions;

/**
 * The options field type `K` declares via `defineField({ options })`.
 */
type DeclaredOptions<K extends FieldTypeName> =
  KnownFields[K] extends FieldType<infer O> ? O : Record<string, never>;

/**
 * The common options legal for field type `K`, keyed off its `columnType` and forced-flag literals.
 * A column-less type stores through its hint alone, so only `translatable` survives there.
 * Its derived table can still be locale-scoped.
 * The unique flags and `index` have no column to cover; `nullable` no cell to hold `NULL`.
 * A forced flag is the type's fact, not the field's: the locked option disappears from the call site.
 * `unique` survives a forced index, upgrading it to a unique one.
 */
type CommonOptions<K extends FieldTypeName> = KnownFields[K]['columnType'] extends false
  ? Pick<FieldOptions, 'translatable'>
  : Omit<
      FieldOptions,
      | (NonNullable<KnownFields[K]['forceNullable']> extends true ? 'nullable' : never)
      | (NonNullable<KnownFields[K]['forceIndex']> extends true ? 'index' : never)
    >;

/**
 * The full options object `field('K', ...)` accepts.
 * A `KnownFieldOptions` member is the complete shape.
 * Otherwise the type's declared options resolve homomorphically.
 * The common options then join per the column gate.
 * The value and presentation options join outside that gate, so every kind carries them.
 */
type InstanceOptions<K extends FieldTypeName> = PresentationOptions &
  ValueOptions<DeclaredOptions<K>, ColumnValue<KnownFields[K]['columnType']>> &
  (K extends keyof KnownFieldOptions
    ? KnownFieldOptions[K]
    : ResolveOptions<DeclaredOptions<K>> & CommonOptions<K>);

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
  translatable: false,
  uniquePerLocale: false,
  uniquePerParent: false,
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
  ...args: [{}] extends [InstanceOptions<K>]
    ? [options?: InstanceOptions<K>]
    : [options: InstanceOptions<K>]
): FieldInstance<K> {
  return { type, options: (args[0] ?? {}) as InstanceOptions<K> };
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

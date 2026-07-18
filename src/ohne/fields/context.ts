import type { CollectionName } from '../collections/known-collections.ts';
import type { Transaction } from '../database/adapter.ts';
import type { LogicalType } from '../database/dialect.ts';
import type { Message } from '../messages/known-messages.ts';
import type { ResolvedFieldOptions } from './field.ts';
import type { AnyOptionDef, ResolvedOptions } from './option.ts';

/**
 * The context every field-type callback receives about a single field instance.
 *
 * Carries the field's name and its resolved options - the type's own options plus the common ones.
 * `emitType` extends it with `importType` (`EmitTypeContext`).
 */
export interface FieldContext<TOptions extends Record<string, AnyOptionDef>> {
  /**
   * The key the field is registered under in its collection: the `title` in `{ title: field('text') }`.
   */
  name: string;

  /**
   * The field instance's fully resolved options: the type's declared options plus the common ones.
   *
   * Every option carrying a default is present, so you read it directly - no `?? default` at the call.
   * Only an option declared without a default may be absent.
   */
  options: ResolvedOptions<TOptions> & ResolvedFieldOptions;
}

/**
 * The context passed to a field type's `emitType`.
 *
 * Adds `importType` so the emitted type expression can reference a type from another module.
 */
export interface EmitTypeContext<
  TOptions extends Record<string, AnyOptionDef>,
> extends FieldContext<TOptions> {
  /**
   * Brings a named type from another module into the generated file, to use in what `emitType` returns.
   *
   * Use it when the emitted type is not a TypeScript built-in but comes from another file or a package.
   * It adds the `import type` for you and returns the local name to drop into your type string.
   * Always use that returned name; it is aliased when another module already exported the same name.
   *
   * Write `path` as you would import it from your own field file.
   * A relative path (`'./_geo.ts'`) resolves against that file; a package name (`'zod'`) is used as is.
   * A `_`-prefixed sibling is the place for such shared types: the field scanner skips it.
   *
   * @example
   * ```ts
   * // emit `LatLng[]`, importing `LatLng` from a sibling module
   * emitType: (ctx) => {
   *   const LatLng = ctx.importType('./_geo.ts', 'LatLng')
   *   return `${LatLng}[]`
   * }
   * ```
   */
  importType(path: string, exportName: string): string;
}

/**
 * Whether a record is being created or updated.
 */
export type FieldOperation = 'create' | 'update';

/**
 * The context a field's write-time callbacks receive.
 * `defaultValue` computes its value from it, and sanitizers clean against it.
 * It carries no error channel, so a sanitizer is structurally unable to report a failure.
 *
 * `input` is the record's raw input, never another field's sanitized output.
 * On update it is the partial input alone, never the stored row.
 */
export interface FieldWriteContext<
  TOptions extends Record<string, AnyOptionDef> = Record<string, AnyOptionDef>,
> extends FieldContext<TOptions> {
  /**
   * The field's dot-path from the record root, composite prefixes included (`sections[2].title`).
   * Equal to `name` for a top-level field.
   */
  path: string;

  /**
   * The name of the collection the record belongs to, narrowed to your schema's collections.
   */
  collection: CollectionName;

  /**
   * Whether the record is being created or updated.
   */
  operation: FieldOperation;

  /**
   * The record's raw input, frozen: sibling values as the caller passed them, never a sanitized read.
   * The record root is a frozen shallow copy; a composite item's object is the caller's own, unfrozen.
   */
  input: Readonly<Record<string, unknown>>;

  /**
   * The open write transaction, so a callback can read committed-in-transaction state.
   */
  tx: Transaction;
}

/**
 * The context a field's validators receive: the write context plus a channel to report sub-path errors.
 * A validator returns a message for its own field; a composite validator instead writes nested paths here.
 */
export interface FieldValidateContext<
  TOptions extends Record<string, AnyOptionDef> = Record<string, AnyOptionDef>,
> extends FieldWriteContext<TOptions> {
  /**
   * The field's error slice, keyed by dot-path, for a composite validator to record a subfield failure.
   * Each value is a message: a key, a `[key, params]` tuple, or a plain string.
   */
  errors: Record<string, Message>;
}

/**
 * A field sanitizer: cleans a value of `TValue` and returns one, never reporting.
 * Runs in order within its tier - the type's sanitizers first, then the instance's.
 * It is type-preserving: the value it receives is already the field's primitive, so it only cleans that.
 *
 * A bivariant method call keeps a concrete field type assignable to the registry's wide `FieldType`.
 * This mirrors `schema` and `emitType`, which are declared as methods for the same reason.
 */
export type FieldSanitizer<
  TOptions extends Record<string, AnyOptionDef> = Record<string, AnyOptionDef>,
  TValue = unknown,
> = {
  clean(value: TValue, ctx: FieldWriteContext<TOptions>): TValue | Promise<TValue>;
}['clean'];

/**
 * A field validator: returns a message to reject its value, or `undefined` to accept it.
 * A message is a param-free key, a `[key, params]` tuple, or a plain string (`Message`).
 * The first own-message stops its tier.
 * A composite validator may instead write sub-path errors into `ctx.errors`.
 *
 * The call is a bivariant method, for the same assignability reason as `FieldSanitizer`.
 */
export type FieldValidator<
  TOptions extends Record<string, AnyOptionDef> = Record<string, AnyOptionDef>,
  TValue = unknown,
> = {
  check(
    value: TValue,
    ctx: FieldValidateContext<TOptions>,
  ): Message | undefined | Promise<Message | undefined>;
}['check'];

/**
 * The storage primitive a column of `TColumn` holds: the type a default value must satisfy.
 * A default is applied before any sanitizer runs, so it must already be that primitive.
 * A `json` or column-less type has no single primitive, so its default value stays `unknown`.
 */
export type ColumnValue<TColumn extends LogicalType | false> = TColumn extends 'text'
  ? string
  : TColumn extends 'integer'
    ? number
    : TColumn extends 'boolean'
      ? boolean
      : unknown;

/**
 * A field's default: a value of `TValue`, `null` for a nullable field, or a callback computing one.
 * The callback receives the write context, so a default may read sibling input or the operation.
 */
export type FieldDefault<TValue, TOptions extends Record<string, AnyOptionDef>> =
  | TValue
  | null
  | ((ctx: FieldWriteContext<TOptions>) => TValue | null | Promise<TValue | null>);

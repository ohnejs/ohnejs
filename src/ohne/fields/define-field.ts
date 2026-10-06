import type { ConditionValue, RecordLink } from '../../utils/index.ts';
import type { LogicalType } from '../database/dialect.ts';
import type { Message } from '../messages/known-messages.ts';
import type {
  ColumnValue,
  EmitTypeContext,
  FieldContext,
  FieldDefault,
  FieldSanitizer,
  FieldValidator,
} from './context.ts';
import type { AnyOptionDef } from './option.ts';
import type { StorageHint } from './storage-hint.ts';

import { validateFieldType } from './validate-field.ts';

/**
 * A field type: the reusable storage contract every `field(...)` instance is built from.
 *
 * These members define how the field's value is stored.
 * The built-ins ship in core; layers add their own under `dirs.fields`.
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
   * Marks the stored value a JSON list.
   * The `includes`, `includesAll`, and `includesAny` operators then probe its elements.
   * Requires `columnType: 'json'`; the field's own validators keep the value list-shaped.
   *
   * @default
   * false
   */
  jsonList?: true;

  /**
   * The options this field type accepts, each declared with `option()`.
   * Names are camelCase and may not shadow a common option (`nullable`, `unique`, `index`, etc.).
   *
   * @example
   * ```ts
   * {
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
   *
   * `emitType` narrows only the generated type.
   * The runtime gates the value at the column primitive and the field's tiers, nothing else.
   * A type that narrows further (a choices union, a shaped object) ships validators that enforce it.
   * Without them the type is a promise the runtime does not keep.
   *
   * When omitted, the shape falls back from `columnType`:
   * - `text` -> `string`
   * - `integer` -> `number`
   * - `real` -> `number`
   * - `boolean` -> `boolean`
   * - `json` -> `unknown`.
   *
   * @example
   * ```ts
   * emitType: () => 'string'
   * emitType: (ctx) => ctx.options.choices.map((c) => `'${c}'`).join(' | ')
   * emitType: (ctx) => ctx.importType('./_geo.ts', 'LatLng')
   * ```
   */
  emitType?(ctx: EmitTypeContext<TOptions>): string | string[];

  /**
   * A value every field of this type takes when a create leaves it out.
   * Pass the value, or a function to compute it; a field's own `default` option overrides it.
   *
   * @example
   * ```ts
   * defineField({ columnType: 'integer', defaultValue: 0 })
   *
   * defineField({
   *   columnType: 'text',
   *   defaultValue: (ctx) => `${ctx.name}-draft`,
   * })
   * ```
   */
  defaultValue?: FieldDefault<ColumnValue<TColumn>, TOptions>;

  /**
   * Functions that clean the value of this type before it is validated, run in order.
   * Each returns the cleaned value and never rejects; leave rejection to a validator.
   *
   * @example
   * ```ts
   * defineField({
   *   columnType: 'text',
   *   sanitizers: [(value) => value.trim()],
   * })
   * ```
   */
  sanitizers?: readonly FieldSanitizer<TOptions, ColumnValue<TColumn>>[];

  /**
   * Functions that check every value of this type, run in order.
   * Return a message to reject the value, or `undefined` to accept it; the first message stops the field.
   * A composite type writes subfield failures into `ctx.errors` instead of returning one.
   *
   * @example
   * ```ts
   * defineField({
   *   columnType: 'text',
   *   validators: [(value) => (value === '' ? 'validation.emptyValue' : undefined)],
   * })
   * ```
   */
  validators?: readonly FieldValidator<TOptions, ColumnValue<TColumn>>[];

  /**
   * Encodes the value into what the column stores, run just before the driver's own codec.
   * Pair it with `deserialize` to invert it on read; a `null` value skips both.
   * The value arriving here already passed the base-type gate, so it is the column's own primitive.
   * `serialize` therefore reshapes within that primitive; only a `json` column carries other shapes.
   * May return a promise; the pipeline awaits it, so a hash or lookup can happen on the write path.
   *
   * @example
   * ```ts
   * // Store text in one canonical Unicode form
   * defineField({
   *   columnType: 'text',
   *   serialize: (value) => (value as string).normalize('NFC'),
   * })
   * ```
   */
  serialize?(value: unknown, ctx: FieldContext<TOptions>): unknown;

  /**
   * Decodes a stored value back into the value a read returns, run just after the driver's codec.
   * The generated record type reflects what this returns; a `null` value skips it.
   * May return a promise; the read path awaits it.
   *
   * @example
   * ```ts
   * defineField({
   *   columnType: 'integer',
   *   deserialize: (value) => new Date(value as number),
   * })
   * ```
   */
  deserialize?(value: unknown, ctx: FieldContext<TOptions>): unknown;

  /**
   * How word search matches a field of this type.
   *
   * - `false` locks the type out: a field of it never matches words and refuses `search: true`.
   * - A function turns the type on and maps each search token to a condition on the field.
   * - `{ default: false }` keeps the type's matcher but leaves its fields off until one sets `search: true`.
   *
   * Without a function, a plain `text` column matches a token by `contains`.
   * A relation or composite has no matcher: search follows it into the records or items it holds.
   * A function on such a type would never run, so it fails at boot.
   * A field's own `search` option decides whether its field joins in; see `FieldSearch` for the hook.
   *
   * @example
   * ```ts
   * search: false
   *
   * search: ({ token }) => (/^\d{4}$/.test(token) ? { startsWith: token } : null)
   *
   * search: { default: false }
   * ```
   */
  search?: false | FieldSearch<TOptions> | { default: false; match?: FieldSearch<TOptions> };

  /**
   * Lists the record links a value holds, each at its path inside the value.
   *
   * - No foreign key holds a link, so deleting a target never cascades and never blocks.
   * - A write checks each link its input provides, for existence and for reach, at the link's own path.
   * - A link that every matched record already holds is never checked.
   * - It may receive an unvalidated value, such as a preview draft, and returns `[]` for what it cannot read.
   * - It requires `columnType: 'json'`.
   *
   * @example
   * ```ts
   * defineField({
   *   columnType: 'json',
   *   links: (value) => (isRecordLink(value) ? [{ path: '', link: value }] : []),
   * })
   * ```
   */
  links?(value: unknown): readonly FieldLink[];
}

/**
 * One record link inside a field's value, at the path where it sits.
 */
export interface FieldLink {
  /**
   * The link's path inside the value: `''` for the value itself, `[2].content[0].link` deeper.
   */
  path: string;

  /**
   * The link itself, by reference, so a read-time resolver can set its `href` in place.
   */
  link: RecordLink;
}

/**
 * The context a field type's search hook receives: the field, plus the token to match.
 */
export interface FieldSearchContext<
  TOptions extends Record<string, AnyOptionDef> = Record<string, AnyOptionDef>,
> extends FieldContext<TOptions> {
  /**
   * One search token, as the query split it: a word or a quoted phrase, never empty.
   * Its case is the user's; normalize it the way the type normalizes a stored value.
   */
  token: string;

  /**
   * Renders a message, like a choice label, in the language the search runs in.
   */
  resolveMessage: (message: Message) => string;
}

/**
 * A field type's search hook: maps one token to a condition on the field, or `null` when it cannot match.
 * The result is the value side of a condition, as `{ [field]: result }`, so `{ in: [...] }` or a scalar.
 * It runs in Node once per token and field, before the query, and never sees a record.
 * Each operator in the result must be one the field admits; any other fails the search loudly.
 *
 * @example
 * ```ts
 * // A `sku` type matches `ab-1042` against the uppercase code it stores
 * defineField({
 *   columnType: 'text',
 *   sanitizers: [(value) => value.toUpperCase()],
 *   search: ({ token }) => (/^[a-z]{2}-\d+$/i.test(token) ? { startsWith: token.toUpperCase() } : null),
 * })
 * ```
 */
export type FieldSearch<
  TOptions extends Record<string, AnyOptionDef> = Record<string, AnyOptionDef>,
> = {
  // A method is bivariant, so a concrete field type stays assignable to the wide `FieldType`.
  match(ctx: FieldSearchContext<TOptions>): ConditionValue | null;
}['match'];

/**
 * Defines a field type.
 *
 * Default-export the result from a file under a layer's `dirs.fields`.
 * The file names the field type: `fields/slug.ts` becomes `slug`.
 *
 * @example
 * ```ts
 * // fields/slug.ts
 * import { defineField } from 'ohnejs'
 *
 * export default defineField({
 *   columnType: 'text',
 *   sanitizers: [(value) => value.trim().toLowerCase().replace(/\s+/g, '-')],
 *   validators: [
 *     (value) =>
 *       /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
 *         ? undefined
 *         : 'Must be lowercase words joined by hyphens',
 *   ],
 * })
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

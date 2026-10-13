import type { FieldChoice } from '../../utils/choice/field-choice.ts';
import type { ConditionObject } from '../../utils/condition/condition-object.ts';
import type { FieldLayout } from '../../utils/field-layout/field-layout.ts';
import type { Link } from '../../utils/rich-text/link.ts';
import type { RichText, RichTextElement, RichTextMark } from '../../utils/rich-text/rich-text.ts';
import type { DeepPrettify } from '../../utils/types/deep-prettify.ts';
import type { CollectionName } from '../runtime/known-collections.ts';
import type { Text } from '../runtime/text-type.ts';

declare const choiceBrand: unique symbol;
declare const itemBrand: unique symbol;

/**
 * A placeholder value type: one of the `choices` the spec declares.
 * `FieldValue` replaces it with the declared choice values, or `string` when the spec declares none.
 */
export interface ChoiceValue {
  /**
   * Brands the placeholder, so no real value matches it.
   */
  readonly [choiceBrand]: true;
}

/**
 * A placeholder value type: one item of the nested `fields` the spec declares.
 * `FieldValue` replaces it with the `FormValue` of those fields.
 */
export interface ItemValue {
  /**
   * Brands the placeholder, so no real value matches it.
   */
  readonly [itemBrand]: true;
}

/**
 * A field description that starts collapsed behind a toggle, for long help.
 */
export interface ExpandableDescription {
  /**
   * The content, shown once expanded.
   * Markdown is supported.
   */
  text: Text;

  /**
   * The toggle's label while the content is collapsed.
   *
   * @default
   * 'dashboard.field.showDescription'
   */
  showLabel?: Text;

  /**
   * The toggle's label while the content is expanded.
   *
   * @default
   * 'dashboard.field.hideDescription'
   */
  hideLabel?: Text;

  /**
   * Whether the content starts expanded.
   *
   * @default
   * false
   */
  expanded?: boolean;
}

/**
 * The options every field spec accepts, whatever its type.
 * A spec is required unless `nullable`, `default`, `when`, or an empty start like a list's `[]` fills it.
 */
export interface CommonFieldOptions {
  /**
   * The label above the control.
   * Omitted, the field name is sentence-cased: `siteName` becomes `Site name`.
   */
  label?: Text;

  /**
   * The help under the control, Markdown supported, or an `ExpandableDescription` for long help.
   */
  description?: Text | ExpandableDescription;

  /**
   * The hint an empty control shows.
   */
  placeholder?: Text;

  /**
   * Whether the value admits `null`; an emptied control then reads `null`.
   *
   * @default
   * false
   */
  nullable?: boolean;

  /**
   * The value the control starts from when the form's `data` has none.
   * `field` checks it against the field's value type.
   */
  default?: unknown;

  /**
   * A condition on the form's other values; while it fails, the field hides and drops out of reads.
   * A gated field is an optional key of `FormValue`.
   */
  when?: ConditionObject;
}

/**
 * The options of a `text` field.
 */
export interface TextFieldOptions {
  /**
   * Whether the empty string is a legal value.
   *
   * @default
   * false
   */
  allowEmpty?: boolean;

  /**
   * The fewest characters the value may hold.
   */
  min?: number;

  /**
   * The most characters the value may hold.
   */
  max?: number;

  /**
   * Whether the control starts as a textarea.
   *
   * @default
   * false
   */
  multiline?: boolean;
}

/**
 * The options of a `color` field.
 */
export interface ColorFieldOptions {
  /**
   * Whether a translucent color is legal, written as `#rrggbbaa`.
   *
   * @default
   * false
   */
  alpha?: boolean;

  /**
   * Colors the control offers to pick from, in any hex spelling.
   */
  swatches?: readonly string[];
}

/**
 * The options of a `number` or `integer` field.
 */
export interface NumberFieldOptions {
  /**
   * The smallest legal value.
   */
  min?: number;

  /**
   * The largest legal value.
   */
  max?: number;
}

/**
 * The options of a `boolean` field.
 */
export interface BooleanFieldOptions {
  /**
   * How the control renders: a checkbox, a switch, or a yes and no button pair.
   *
   * @default
   * 'checkbox'
   */
  display?: 'checkbox' | 'switch' | 'buttons';

  /**
   * The `buttons` label for `true`.
   *
   * @default
   * 'dashboard.yes'
   */
  trueLabel?: Text;

  /**
   * The `buttons` label for `false`.
   *
   * @default
   * 'dashboard.no'
   */
  falseLabel?: Text;
}

/**
 * The options of a `select` field.
 */
export interface SelectFieldOptions {
  /**
   * The values the field admits; a plain string is its own label.
   */
  choices: readonly FieldChoice<Text>[];

  /**
   * How the control renders: a dropdown, or one button per choice.
   *
   * @default
   * 'dropdown'
   */
  display?: 'dropdown' | 'buttons';
}

/**
 * The options of a `multiSelect` field.
 */
export interface MultiSelectFieldOptions {
  /**
   * The values the field admits; omitted, any string is an entry.
   */
  choices?: readonly FieldChoice<Text>[];

  /**
   * The fewest entries the list may hold.
   */
  min?: number;

  /**
   * The most entries the list may hold.
   */
  max?: number;
}

/**
 * The options of a `date` or `time` field.
 */
export interface DateFieldOptions {
  /**
   * The earliest legal value, as `YYYY-MM-DD` for a date and `HH:MM:SS` for a time.
   */
  min?: string;

  /**
   * The latest legal value, as `YYYY-MM-DD` for a date and `HH:MM:SS` for a time.
   */
  max?: string;
}

/**
 * The options of a `dateTime` field.
 */
export interface DateTimeFieldOptions {
  /**
   * The earliest legal instant, as epoch milliseconds or an ISO string.
   */
  min?: number | string;

  /**
   * The latest legal instant, as epoch milliseconds or an ISO string.
   */
  max?: number | string;

  /**
   * Whether the cell shows the instant relative to now.
   *
   * @default
   * false
   */
  relativeTime?: boolean;

  /**
   * The IANA timezone the control edits in; omitted, the user's preference.
   */
  timezone?: string;
}

/**
 * The options of a `link` field.
 */
export interface LinkFieldOptions {
  /**
   * The collections a record link may target; omitted, every collection the user may read.
   */
  collections?: readonly CollectionName[];
}

/**
 * The options of a `record` field.
 */
export interface RecordFieldOptions {
  /**
   * The collection the referenced record belongs to.
   */
  collection: CollectionName;
}

/**
 * The options of a `records` field.
 */
export interface RecordsFieldOptions {
  /**
   * The collection the referenced records belong to.
   */
  collection: CollectionName;

  /**
   * Whether an empty list is legal.
   *
   * @default
   * true
   */
  allowEmpty?: boolean;

  /**
   * The fewest records the list may hold.
   */
  min?: number;

  /**
   * The most records the list may hold.
   */
  max?: number;
}

/**
 * The options of a `richText` field.
 */
export interface RichTextFieldOptions {
  /**
   * Whether the value holds at most one paragraph, rendered without a block tag.
   *
   * @default
   * false
   */
  inline?: boolean;

  /**
   * The block elements the editor offers.
   */
  elements?: readonly RichTextElement[];

  /**
   * The marks the editor offers.
   */
  marks?: readonly RichTextMark[];

  /**
   * Whether links are allowed, or the collections a record link may target.
   *
   * @default
   * true
   */
  links?: boolean | readonly CollectionName[];

  /**
   * Whether Shift+Enter inserts a line break.
   *
   * @default
   * true
   */
  lineBreaks?: boolean;

  /**
   * Whether an empty value is legal.
   *
   * @default
   * false
   */
  allowEmpty?: boolean;

  /**
   * The fewest characters the text may hold.
   */
  min?: number;

  /**
   * The most characters the text may hold.
   */
  max?: number;
}

/**
 * The options of an `object` field.
 */
export interface ObjectFieldOptions {
  /**
   * The nested fields, by name.
   */
  fields: FieldSpecs;

  /**
   * How the nested form arranges the fields.
   */
  layout?: FieldLayout<string, Text>;
}

/**
 * The options of a `repeater` field.
 */
export interface RepeaterFieldOptions extends ObjectFieldOptions {
  /**
   * Whether an empty list is legal.
   *
   * @default
   * true
   */
  allowEmpty?: boolean;

  /**
   * The fewest items the list may hold.
   */
  min?: number;

  /**
   * The most items the list may hold.
   */
  max?: number;
}

/**
 * Every field type the dashboard can render, by name: what `registerFieldType` registered.
 * Each entry pairs the type's own options with its value type.
 * `ChoiceValue` and `ItemValue` are placeholders `FieldValue` fills from a spec's options.
 * A layer or app adds its own beside the `registerFieldType` call, as a plain entry.
 *
 * @example
 * ```ts
 * declare module 'ohnejs/dashboard' {
 *   interface KnownFieldTypes {
 *     rating: { options: { max?: number }; value: number }
 *   }
 * }
 * ```
 */
export interface KnownFieldTypes {
  /**
   * A text value.
   */
  text: { options: TextFieldOptions; value: string };

  /**
   * Formatted text with links, as a JSON tree.
   */
  richText: { options: RichTextFieldOptions; value: RichText };

  /**
   * A whole number.
   */
  integer: { options: NumberFieldOptions; value: number };

  /**
   * A finite floating-point number.
   */
  number: { options: NumberFieldOptions; value: number };

  /**
   * A true or false value.
   */
  boolean: { options: BooleanFieldOptions; value: boolean };

  /**
   * One value out of the declared choices.
   */
  select: { options: SelectFieldOptions; value: ChoiceValue };

  /**
   * An ordered list of distinct values, out of the declared choices when there are any.
   */
  multiSelect: { options: MultiSelectFieldOptions; value: ChoiceValue[] };

  /**
   * A calendar day as `YYYY-MM-DD`.
   */
  date: { options: DateFieldOptions; value: string };

  /**
   * A time of day as `HH:MM:SS`.
   */
  time: { options: DateFieldOptions; value: string };

  /**
   * A hex color as lowercase `#rrggbb`, or `#rrggbbaa` when the field takes `alpha`.
   */
  color: { options: ColorFieldOptions; value: string };

  /**
   * An email address, trimmed with its local part and domain lowercased.
   */
  email: { options: Record<never, never>; value: string };

  /**
   * An absolute `http:` or `https:` address with its scheme and host lowercased.
   */
  url: { options: Record<never, never>; value: string };

  /**
   * An instant as epoch milliseconds.
   */
  dateTime: { options: DateTimeFieldOptions; value: number };

  /**
   * A link to a record or to an address.
   */
  link: { options: LinkFieldOptions; value: Link };

  /**
   * The `UUID` of one record of another collection.
   */
  record: { options: RecordFieldOptions; value: string };

  /**
   * The `UUID`s of an ordered list of records of another collection.
   */
  records: { options: RecordsFieldOptions; value: string[] };

  /**
   * A nested group of fields.
   */
  object: { options: ObjectFieldOptions; value: ItemValue };

  /**
   * An ordered list of nested field groups.
   */
  repeater: { options: RepeaterFieldOptions; value: ItemValue[] };
}

/**
 * The name of a field type `KnownFieldTypes` declares.
 */
export type FieldTypeName = keyof KnownFieldTypes;

/**
 * The field types whose options are all optional, so `field` takes them without an options object.
 */
export type OptionalFieldType = {
  [K in FieldTypeName]: {} extends KnownFieldTypes[K]['options'] ? K : never;
}[FieldTypeName];

/**
 * Everything `field(type, ...)` accepts for type `K`: the common options and the type's own.
 */
export type FieldOptionsOf<K extends FieldTypeName> = CommonFieldOptions &
  KnownFieldTypes[K]['options'];

/**
 * One field of a page form: its type name and options, as `field` returns them.
 * `O` keeps the options exactly as written, so `FieldValue` can narrow choices and nested values.
 */
export interface FieldSpec<K extends FieldTypeName = FieldTypeName, O = unknown> {
  /**
   * The field type name.
   */
  readonly type: K;

  /**
   * The options as written.
   */
  readonly options: O;
}

/**
 * A page form's fields, by name.
 */
export type FieldSpecs = Readonly<Record<string, FieldSpec>>;

/**
 * The value a spec of type `K` with options `O` holds: choices and nested items filled in, `null` if nullable.
 */
export type FieldValue<K extends FieldTypeName, O> =
  | Substitute<KnownFieldTypes[K]['value'], O>
  | (O extends { readonly nullable: true } ? null : never);

/**
 * The value a form over `F` reads: a `when`-gated key is optional, every other key is required.
 */
export type FormValue<F extends FieldSpecs> = DeepPrettify<
  { -readonly [N in Exclude<keyof F, GatedName<F>>]: SpecValue<F[N]> } & {
    -readonly [N in GatedName<F>]?: SpecValue<F[N]>;
  }
>;

type SpecValue<S> = S extends FieldSpec<infer K, infer O> ? FieldValue<K, O> : never;

type GatedName<F extends FieldSpecs> = {
  [N in keyof F]: F[N]['options'] extends { readonly when: object } ? N : never;
}[keyof F];

type Substitute<V, O> = V extends ChoiceValue
  ? ChoiceOf<O>
  : V extends ItemValue
    ? O extends { readonly fields: infer F extends FieldSpecs }
      ? FormValue<F>
      : never
    : V extends readonly (infer E)[]
      ? Substitute<E, O>[]
      : V;

type ChoiceOf<O> = O extends { readonly choices: readonly (infer C)[] }
  ? C extends { readonly value: infer V }
    ? V
    : C
  : string;

type Exact<O, S> = O & { [K in Exclude<keyof O, keyof S>]: never };

type DefaultFits<K extends FieldTypeName, O> = O extends { readonly default: infer D }
  ? [Writable<D>] extends [FieldValue<K, O>]
    ? unknown
    : { default: FieldValue<K, O> }
  : unknown;

type Writable<T> = T extends readonly (infer E)[]
  ? Writable<E>[]
  : T extends object
    ? { -readonly [K in keyof T]: Writable<T[K]> }
    : T;

/**
 * Declares one field of a page form, the browser twin of the server's `field()`.
 * The options are checked against the type's `KnownFieldTypes` entry: unknown keys and a wrong `default` fail.
 * The returned spec keeps the options' literal types, so `FormValue` narrows choices and nested values.
 * A type whose options are all optional takes no options object.
 *
 * @example
 * ```ts
 * const fields = {
 *   siteName: field('text', { label: 'Site name', max: 80 }),
 *   theme: field('select', { choices: ['light', 'dark'], default: 'light' }),
 *   motto: field('text', { nullable: true }),
 * }
 *
 * type Settings = FormValue<typeof fields>
 * // -> { siteName: string; theme: 'light' | 'dark'; motto: string | null }
 * ```
 */
export function field<K extends OptionalFieldType>(type: K): FieldSpec<K, {}>;
export function field<K extends FieldTypeName, const O extends FieldOptionsOf<K>>(
  type: K,
  options: Exact<O, FieldOptionsOf<K>> & DefaultFits<K, O>,
): FieldSpec<K, O>;
export function field(type: FieldTypeName, options: object = {}): FieldSpec {
  return { type, options };
}

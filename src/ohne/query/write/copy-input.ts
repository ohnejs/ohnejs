import type { FieldQueryMeta } from '../metadata.ts';

import { deepOmit, isArray, isPlainObject, isString, isUndefined } from '../../../utils/index.ts';
import { blockQueryMetadata, isTranslatableEntry } from '../metadata.ts';

/**
 * Which fields a copy carries and the write it feeds.
 */
export interface CopyInputOptions {
  /**
   * The fields that carry over.
   *
   * - `'all'` copies every settable field.
   * - `'translatable'` copies the `companion` and `localeScoped` ones, the values that differ per locale.
   * - `'shared'` copies the rest, the values every locale shares.
   */
  only: 'all' | 'translatable' | 'shared';

  /**
   * Whether a top-level `unique` field carries over.
   * A copy of a unique value collides with its source, so a fresh record drops them.
   * Composite and subfield uniques always carry over, so a collision there answers an honest failure.
   */
  uniques: 'keep' | 'drop';

  /**
   * The write the input feeds: an `'update'` drops `immutable` fields at any depth, a `'create'` keeps them.
   */
  operation: 'create' | 'update';

  /**
   * Where the values come from.
   *
   * - `'read'` is a stored record, so an unreadable field or a `copy: false` type never carries over.
   * - `'given'` is a copy hook's result, whose fresh values may fill those fields too.
   */
  values: 'read' | 'given';
}

/**
 * Projects a record onto the write input that copies it, to another locale or into a fresh record.
 *
 * Only a settable field carries over: one with a field type, writable, and not an inverse.
 * An inverse relation reads the owner's junction, so that content is the owner's.
 * A read value of an unreadable field or a `copy: false` type never carries over, since it is no write input.
 * A field the record does not carry is skipped; `null` passes through as an explicit clearing.
 * The walk descends composite items and block envelopes, dropping every key the wire denies.
 * A value that does not match its field's shape passes through undescended, as the wire walk leaves it.
 * Every value sheds its `UUID` keys at every depth, so copied child and block rows insert as fresh rows.
 * Locale-scoped tables key rows by `UUID`, so a reused identity would collide across locales.
 * A copy hook's result re-projects through this, and that re-projection is the clamp.
 * Whatever the hook returns, no other field ever writes.
 */
export function copyInput(
  fields: Record<string, FieldQueryMeta>,
  record: Record<string, unknown>,
  options: CopyInputOptions,
): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(fields)) {
    if (!settable(field, options) || field.inverse === true) continue;
    const translatable = isTranslatableEntry(field);
    if (options.only === 'translatable' && !translatable) continue;
    if (options.only === 'shared' && translatable) continue;
    if (options.uniques === 'drop' && field.options?.unique === true) continue;
    const value = record[name];
    if (isUndefined(value)) continue;
    input[name] = strippedValue(field, value, options);
  }
  return input;
}

/**
 * Whether a copy may write the field at all: a typed, writable entry, and for read values a copyable one.
 * An `'update'` also refuses an `immutable` one.
 */
function settable(field: FieldQueryMeta, options: CopyInputOptions): boolean {
  if (isUndefined(field.fieldType) || field.writable === false) return false;
  const read = options.values === 'read';
  if (read && (field.readable === false || field.fieldType.copy === false)) return false;
  return options.operation === 'create' || field.immutable !== true;
}

/**
 * Strips one field's value by its kind: composite and block values descend, anything else sheds `UUID`s.
 */
function strippedValue(field: FieldQueryMeta, value: unknown, options: CopyInputOptions): unknown {
  const subfields = field.subfields as Record<string, FieldQueryMeta>;
  if (field.kind === 'childOne' && isPlainObject<Record<string, unknown>>(value)) {
    return strippedScope(value, subfields, options);
  }
  if (field.kind === 'childMany' && isArray(value)) {
    return value.map((item) =>
      isPlainObject<Record<string, unknown>>(item)
        ? strippedScope(item, subfields, options)
        : deepOmit(item, ['UUID']),
    );
  }
  if (field.kind === 'blocks' && isArray(value)) {
    return value.map((item) => strippedBlock(field.allow as readonly string[], item, options));
  }
  return deepOmit(value, ['UUID']);
}

/**
 * Strips one composite item's keys to the settable subfields.
 * The item `UUID` carries no field type, so it drops with the unknown keys.
 */
function strippedScope(
  item: Record<string, unknown>,
  fields: Record<string, FieldQueryMeta>,
  options: CopyInputOptions,
): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(item)) {
    const field = fields[name];
    if (isUndefined(field) || !settable(field, options)) continue;
    clean[name] = strippedValue(field, value, options);
  }
  return clean;
}

/**
 * Strips one block envelope to its type name and stripped fields, resolved from the block registry.
 * An envelope outside the field's `allow` or without a fields object passes through undescended.
 */
function strippedBlock(
  allow: readonly string[],
  item: unknown,
  options: CopyInputOptions,
): unknown {
  if (
    !isPlainObject<Record<string, unknown>>(item) ||
    !isString(item.block) ||
    !allow.includes(item.block) ||
    !isPlainObject<Record<string, unknown>>(item.fields)
  ) {
    return deepOmit(item, ['UUID']);
  }
  return {
    block: item.block,
    fields: strippedScope(item.fields, blockQueryMetadata(item.block).fields, options),
  };
}

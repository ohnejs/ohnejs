import type { FieldQueryMeta } from '../metadata.ts';

import { deepOmit, isArray, isPlainObject, isString, isUndefined } from '../../../utils/index.ts';
import { blockQueryMetadata } from '../metadata.ts';

/**
 * Projects a record onto the write input that copies its translation to another locale.
 *
 * Only translatable (`companion` or `localeScoped`), writable, mutable fields carry over.
 * An inverse relation reads the owner's junction, so it never carries over - that content is the owner's.
 * The system entries carry no locale marker, so they drop with the rest.
 * A field the record does not carry is skipped; `null` passes through as an explicit clearing.
 * The walk descends composite items and block envelopes, dropping every key the wire denies in an update.
 * A value that does not match its field's shape passes through undescended, as the wire walk leaves it.
 * Every value sheds its `UUID` keys at every depth, so copied child and block rows insert as fresh rows.
 * Locale-scoped tables key rows by `UUID`, so a reused identity would collide across locales.
 * The copy endpoint builds its default input through this and re-projects a `copyTranslation` result.
 * That re-projection is the clamp: whatever the hook returns, no other field ever writes.
 */
export function copyTranslationInput(
  fields: Record<string, FieldQueryMeta>,
  record: Record<string, unknown>,
): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(fields)) {
    if (field.companion !== true && field.localeScoped !== true) continue;
    if (field.inverse === true || field.writable === false || field.immutable === true) continue;
    const value = record[name];
    if (isUndefined(value)) continue;
    input[name] = strippedValue(field, value);
  }
  return input;
}

/**
 * Strips one field's value by its kind: composite and block values descend, anything else sheds `UUID`s.
 */
function strippedValue(field: FieldQueryMeta, value: unknown): unknown {
  const subfields = field.subfields as Record<string, FieldQueryMeta>;
  if (field.kind === 'childOne' && isPlainObject<Record<string, unknown>>(value)) {
    return strippedScope(value, subfields);
  }
  if (field.kind === 'childMany' && isArray(value)) {
    return value.map((item) =>
      isPlainObject<Record<string, unknown>>(item)
        ? strippedScope(item, subfields)
        : deepOmit(item, ['UUID']),
    );
  }
  if (field.kind === 'blocks' && isArray(value)) {
    return value.map((item) => strippedBlock(field.allow as readonly string[], item));
  }
  return deepOmit(value, ['UUID']);
}

/**
 * Strips one composite item's keys to the settable subfields: known, writable, mutable ones.
 * The item `UUID` carries no `fieldType`, so it drops with the unknown keys.
 */
function strippedScope(
  item: Record<string, unknown>,
  fields: Record<string, FieldQueryMeta>,
): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(item)) {
    const field = fields[name];
    if (isUndefined(field) || isUndefined(field.fieldType)) continue;
    if (field.writable === false || field.immutable === true) continue;
    clean[name] = strippedValue(field, value);
  }
  return clean;
}

/**
 * Strips one block envelope to its type name and stripped fields, resolved from the block registry.
 * An envelope outside the field's `allow` or without a fields object passes through undescended.
 */
function strippedBlock(allow: readonly string[], item: unknown): unknown {
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
    fields: strippedScope(item.fields, blockQueryMetadata(item.block).fields),
  };
}

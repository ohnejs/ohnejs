import type { FieldSearch, FieldType } from './define-field.ts';
import type { StorageHint } from './storage-hint.ts';

import { isBoolean, isFunction, isUndefined } from '../../utils/index.ts';

/**
 * The search hook a field type declares, bare or inside `{ default: false, match }`.
 * The engine runs it per token; without one, a plain `text` column matches by `contains`.
 */
export function searchHook(fieldType: FieldType): FieldSearch | undefined {
  const { search } = fieldType;
  if (isFunction(search)) return search;
  return search === false ? undefined : search?.match;
}

/**
 * Whether word search has a way to match a field of this type in its own column.
 * A hook does; a plain `text` column without one matches by `contains`.
 * A field with a storage hint keeps its value elsewhere, so it has no column matcher.
 */
export function hasColumnMatcher(fieldType: FieldType, hint: StorageHint | undefined): boolean {
  if (!isUndefined(hint) || fieldType.search === false) return false;
  return !isUndefined(searchHook(fieldType)) || fieldType.columnType === 'text';
}

/**
 * Resolves whether word search matches one field, from its type, its options, and its hint.
 *
 * - A type locked with `search: false` is off, and so is a write-only field.
 * - The field's own `search` option wins next.
 * - A type declaring `{ default: false }` is off.
 * - An inverse `records` field is off.
 * - Otherwise a field with a column matcher is on, as is every relation and composite.
 */
export function resolveFieldSearch(
  fieldType: FieldType,
  options: Readonly<Record<string, unknown>>,
  hint: StorageHint | undefined,
): boolean {
  if (fieldType.search === false || options.readable === false) return false;
  if (isBoolean(options.search)) return options.search;
  if (!isUndefined(fieldType.search) && !isFunction(fieldType.search)) return false;
  if (hint?.kind === 'junction' && !isUndefined(hint.inverse)) return false;
  return !isUndefined(hint) || hasColumnMatcher(fieldType, hint);
}

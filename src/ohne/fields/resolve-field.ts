import type { FieldType } from './define-field.ts';
import type { FieldInstance, ResolvedFieldOptions } from './field.ts';
import type { StorageHint } from './storage-hint.ts';

import { isUndefined } from '../../utils/index.ts';
import { resolveFieldOptions } from './field.ts';

/**
 * How a field stores its value, classified from the materialized hint.
 * `column` is a plain column; `foreignKey` a column carrying a target `UUID`.
 * `junction`, `childOne`, `childMany`, and `blocks` live outside the owner's table.
 */
export type FieldStorageKind =
  | 'column'
  | 'foreignKey'
  | 'junction'
  | 'childOne'
  | 'childMany'
  | 'blocks';

/**
 * One field instance resolved against its type: options filled, hint materialized, storage classified.
 */
export interface ResolvedFieldStorage {
  /**
   * The field's registered type.
   */
  fieldType: FieldType;

  /**
   * The instance options with every default applied and `forceNullable` folded into `nullable`.
   */
  options: ResolvedFieldOptions & Record<string, unknown>;

  /**
   * The materialized storage hint; absent for a plain column.
   */
  hint: StorageHint | undefined;

  /**
   * The storage classification the hint routes to.
   */
  kind: FieldStorageKind;
}

/**
 * Resolves one field instance's storage: options, hint, and classification, in one pass.
 * The desired schema and the query metadata both route fields through it, so the partition lives once.
 * `name` reaches the field type's `schema` as `ctx.name`.
 */
export function resolveFieldStorage(
  name: string,
  instance: FieldInstance,
  fieldType: FieldType,
): ResolvedFieldStorage {
  const options = resolveFieldOptions(fieldType, { ...instance.options });
  const hint = fieldType.schema?.({ name, options });
  return { fieldType, options, hint, kind: storageKind(hint) };
}

/**
 * Classifies a hint into its storage kind, splitting `child` by cardinality; no hint is a column.
 */
function storageKind(hint: StorageHint | undefined): FieldStorageKind {
  if (isUndefined(hint)) return 'column';
  if (hint.kind === 'child') return hint.cardinality === 'one' ? 'childOne' : 'childMany';
  return hint.kind;
}

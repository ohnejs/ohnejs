import type { FieldQueryMeta } from './metadata.ts';

/**
 * Whether a field holds a list: a relation list, a repeater, a blocks field, or a `jsonList` column.
 */
export function isListField(meta: FieldQueryMeta): boolean {
  return (
    meta.kind === 'records' ||
    meta.kind === 'childMany' ||
    meta.kind === 'blocks' ||
    meta.jsonList === true
  );
}

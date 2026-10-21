import type { FieldQueryMeta } from './metadata.ts';

import { isUndefined } from '../../utils/index.ts';

/**
 * Whether a query may sort by a field: a column, or a composite whose sort-key part is readable.
 * A hidden part refuses, so ordering never leaks its values.
 */
export function isSortable(field: FieldQueryMeta): boolean {
  if (!isUndefined(field.column)) return true;
  if (isUndefined(field.orderBy)) return false;
  return field.subfields?.[field.orderBy]?.readable !== false;
}

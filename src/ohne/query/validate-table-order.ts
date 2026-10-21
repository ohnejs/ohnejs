import type { CollectionQueryMeta } from './metadata.ts';

import { isUndefined } from '../../utils/index.ts';
import { ohneError } from '../error/ohne-error.ts';
import { isSortable } from './sortable.ts';

/**
 * Validates a collection's declared `dashboard.table.order` against the fields it sorts by.
 *
 * Each entry must name a field a query sorts by, whose sort key is not a `json` value.
 * The dashboard table sorts by nothing else, so a declared default never silently loses an entry.
 * The definition pass already refused an unknown, write-only, or repeated field.
 * A violation throws `ohneError`, naming the field and its collection.
 */
export function validateTableOrder(
  meta: CollectionQueryMeta,
  order: readonly string[] | undefined,
): void {
  for (const entry of order ?? []) {
    const name = entry.startsWith('-') ? entry.slice(1) : entry;
    const field = meta.fields[name];
    if (isUndefined(field)) continue;
    const key = isUndefined(field.orderBy) ? field : field.subfields?.[field.orderBy];
    if (isSortable(field) && key?.logicalType !== 'json') continue;
    throw ohneError({
      title: `\`dashboard.table.order\` names unsortable field \`${name}\``,
      body: [
        `Field \`${name}\` in collection \`${meta.collection}\` holds no single value to sort by.`,
        'Sort by a plain column, a reference, or a composite with a sort key.',
      ],
    });
  }
}

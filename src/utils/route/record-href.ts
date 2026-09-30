import type { SearchParamValue } from '../search-params/coerce-token.ts';

import { stringifySearchParams } from '../search-params/stringify-search-params.ts';
import { fillRoute } from './fill-route.ts';

/**
 * The slice of a described collection a record link needs.
 */
export interface RecordHrefTarget {
  /**
   * The collection's URL segment under `/collections/`.
   */
  segment: string;

  /**
   * The declared dashboard path a record opens at, its `[uuid]` token standing for the record.
   * If omitted, the record opens in the editor under `/collections/`.
   */
  recordPath?: string;
}

/**
 * The dashboard path that opens one record: its collection's `recordPath`, or the record editor.
 * The `UUID` is percent-encoded into the path, and `params` join the query it may already carry.
 *
 * @example
 * ```ts
 * recordHref({ segment: 'items' }, '42')
 * // -> '/collections/items/42'
 *
 * recordHref({ segment: 'items' }, '42', { locale: 'de' })
 * // -> '/collections/items/42?locale=de'
 *
 * recordHref({ segment: 'uploads', recordPath: '/media?details=[uuid]' }, '42', { locale: 'de' })
 * // -> '/media?details=42&locale=de'
 * ```
 */
export function recordHref(
  collection: RecordHrefTarget,
  uuid: string,
  params: { [key: string]: SearchParamValue | undefined } = {},
): string {
  const { segment, recordPath = '/collections/[segment]/[uuid]' } = collection;
  const path = fillRoute(recordPath, { segment, uuid });
  const query = stringifySearchParams(params);
  if (query === '') return path;
  return `${path}${path.includes('?') ? '&' : '?'}${query}`;
}

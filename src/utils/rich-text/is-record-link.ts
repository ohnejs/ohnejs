import type { RecordLink } from './link.ts';

import { isString } from '../is/is-string.ts';
import { isLink } from './is-link.ts';

/**
 * Whether `value` is shaped like a `RecordLink`, by the same structural rules as `isLink`.
 *
 * @example
 * ```ts
 * isRecordLink({ collection: 'Pages', record: '019f3c1a-8b2d-7f4e-9a6b-1c2d3e4f5a6b' }) // -> true
 * isRecordLink({ url: 'https://x.y' })                                                  // -> false
 * ```
 */
export function isRecordLink(value: unknown): value is RecordLink {
  return isLink(value) && 'collection' in value && isString(value.collection);
}

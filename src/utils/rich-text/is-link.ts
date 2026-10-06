import type { Link } from './link.ts';

import { collectIssues, walkLink } from './_walk.ts';

/**
 * Whether `value` is shaped like a `Link`: known keys of the right types, and a `UUID` record.
 * It judges structure only, so a padded `url`, a `#` in `hash` or an `href` still pass.
 *
 * @example
 * ```ts
 * isLink({ url: ' https://x.y ' })                                                // -> true
 * isLink({ collection: 'Pages', record: '019f3c1a-8b2d-7f4e-9a6b-1c2d3e4f5a6b' }) // -> true
 * isLink({ collection: 'Pages', record: 'home' })                                 // -> false
 * isLink({ url: 'https://x.y', rel: 'nofollow' })                                 // -> false
 * ```
 */
export function isLink(value: unknown): value is Link {
  return collectIssues((report) => walkLink(value, '', undefined, report)).length === 0;
}

import type { Link, RecordLink } from './link.ts';

import { isUndefined } from '../is/is-undefined.ts';

/**
 * Returns the canonical form of a link, as a new object.
 * It drops `href` and a `newTab` that is not `true`, trims `url`, and strips leading `#`s from `hash`.
 * An empty `hash` is dropped.
 *
 * @example
 * ```ts
 * normalizeLink({ url: ' https://x.y ', newTab: false })
 * // -> { url: 'https://x.y' }
 *
 * normalizeLink({ collection: 'Pages', record: '019f3c1a-...', hash: '#top', href: '/about' })
 * // -> { collection: 'Pages', record: '019f3c1a-...', hash: 'top' }
 * ```
 */
export function normalizeLink<C extends string>(link: Link<C>): Link<C> {
  const newTab = link.newTab === true ? { newTab: true } : {};
  if (!holdsCollection(link)) return { url: link.url.trim(), ...newTab };
  const hash = link.hash?.replace(/^#+/, '');
  return { collection: link.collection, record: link.record, ...(hash ? { hash } : {}), ...newTab };
}

/**
 * Whether a link points at a record, the way `isLink` tells the two kinds apart.
 */
function holdsCollection<C extends string>(link: Link<C>): link is RecordLink<C> {
  return 'collection' in link && !isUndefined(link.collection);
}

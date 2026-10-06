import type { RichTextIssue } from './rich-text.ts';

import { collectIssues, linkPolicy, walkLink } from './_walk.ts';

/**
 * Lists every problem with a link, each at its path, where `''` is the link itself.
 * `links` is `false` to allow no link, `true` to allow URLs, or the collections a record link may point into.
 * A URL must pass `isSafeHref`, and a `hash` may hold no whitespace, `#` or control character.
 * It never throws.
 *
 * @example
 * ```ts
 * checkLink({ url: 'https://x.y' })
 * // -> []
 *
 * checkLink({ url: 'javascript:x' })
 * // -> [{ path: 'url', key: 'validation.invalidLink' }]
 *
 * checkLink({ collection: 'Users', record: '019f3c1a-8b2d-7f4e-9a6b-1c2d3e4f5a6b' }, ['Pages'])
 * // -> [{ path: 'collection', key: 'validation.invalidChoice' }]
 * ```
 */
export function checkLink(
  value: unknown,
  links: boolean | readonly string[] = true,
): RichTextIssue[] {
  return collectIssues((report) => walkLink(value, '', linkPolicy(links), report));
}

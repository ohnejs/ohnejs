import type { Link } from './link.ts';

import { leaves } from './_read.ts';
import { isLink } from './is-link.ts';

/**
 * One link in a rich text value, at the path where it sits.
 */
export interface RichTextLink<C extends string = string> {
  /**
   * The path of the link, in `[i]` and dot form, as `checkRichText` writes it.
   */
  path: string;

  /**
   * The link itself, by reference, so a resolver can set its `href` in place.
   */
  link: Link<C>;
}

/**
 * Lists the links of a rich text value in document order, each at its path.
 * It accepts any value, such as an unvalidated draft, and skips whatever is not shaped like a link.
 * Lists nested deeper than 4 levels are skipped too.
 *
 * @example
 * ```ts
 * richTextLinks([
 *   { kind: 'paragraph', content: [{ text: 'a' }, { text: 'b', link: { url: '/b' } }] },
 *   { kind: 'list', ordered: false, items: [{ content: [{ text: 'c', link: { url: '/c' } }] }] },
 * ])
 * // -> [
 * //   { path: '[0].content[1].link', link: { url: '/b' } },
 * //   { path: '[1].items[0].content[0].link', link: { url: '/c' } },
 * // ]
 *
 * richTextLinks('not rich text')
 * // -> []
 * ```
 */
export function richTextLinks(value: unknown): RichTextLink[] {
  return leaves(value).flatMap(({ path, runs }) =>
    runs.flatMap((run) =>
      isLink(run.link) ? [{ path: `${path}[${run.index}].link`, link: run.link }] : [],
    ),
  );
}

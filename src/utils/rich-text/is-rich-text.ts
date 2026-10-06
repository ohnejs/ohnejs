import type { RichText } from './rich-text.ts';

import { collectIssues, walkRichText } from './_walk.ts';

/**
 * Whether `value` is shaped like `RichText`: known kinds and keys of the right types, lists at most 4 deep.
 * It judges structure only, never what options allow.
 * Duplicate marks, an `href`, a padded `url` and a `#` in `hash` pass, as `normalizeRichText` fixes them.
 *
 * @example
 * ```ts
 * isRichText([{ kind: 'heading', level: 6, content: [{ text: 'a', marks: ['del', 'del'] }] }])
 * // -> true
 *
 * isRichText([{ kind: 'paragraph', content: [{ text: 'a', style: 'bold' }] }])
 * // -> false
 *
 * isRichText('a')
 * // -> false
 * ```
 */
export function isRichText(value: unknown): value is RichText {
  return collectIssues((report) => walkRichText(value, undefined, report)).length === 0;
}

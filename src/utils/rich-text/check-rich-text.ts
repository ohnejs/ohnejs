import type { RichTextElement, RichTextIssue, RichTextMark, RichTextOptions } from './rich-text.ts';

import { collectIssues, linkPolicy, walkRichText } from './_walk.ts';

const DEFAULT_ELEMENTS: readonly RichTextElement[] = ['h2', 'h3', 'ul', 'ol', 'blockquote'];
const DEFAULT_MARKS: readonly RichTextMark[] = ['strong', 'em', 'code'];

/**
 * Lists every problem with a rich text value under `options`, at most one per path, in document order.
 * Paths use `[i]` and dots, where `''` is the value itself.
 * Each link is judged as `checkLink` judges it, and lists may nest at most 4 deep.
 * It never throws.
 *
 * @example
 * ```ts
 * checkRichText([{ kind: 'heading', level: 4, content: [{ text: 'a' }] }])
 * // -> [{ path: '[0].level', key: 'validation.invalidChoice' }]
 *
 * checkRichText([{ kind: 'paragraph', content: [{ text: 'a', link: { url: '/a' } }] }], { links: false })
 * // -> [{ path: '[0].content[0].link', key: 'validation.linksNotAllowed' }]
 * ```
 */
export function checkRichText(value: unknown, options: RichTextOptions = {}): RichTextIssue[] {
  const {
    inline = false,
    elements = DEFAULT_ELEMENTS,
    marks = DEFAULT_MARKS,
    links = true,
  } = options;
  const policy = {
    inline,
    elements: new Set(elements),
    marks: new Set(marks),
    links: linkPolicy(links),
  };
  return collectIssues((report) => walkRichText(value, policy, report));
}

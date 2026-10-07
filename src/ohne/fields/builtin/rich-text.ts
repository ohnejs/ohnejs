import type { RichText, RichTextElement, RichTextMark } from '../../../utils/index.ts';
import type { CollectionName } from '../../collections/known-collections.ts';

import {
  checkRichText,
  isRecordLink,
  isRichText,
  isUndefined,
  normalizeRichText,
  RICH_TEXT_DEFAULT_ELEMENTS,
  RICH_TEXT_DEFAULT_MARKS,
  richTextLength,
  richTextLinks,
} from '../../../utils/index.ts';
import { defineField } from '../define-field.ts';
import { linksParameter, registeredLinks } from '../link-collections.ts';
import { option } from '../option.ts';
import { reportIssues } from '../report-issues.ts';
import { validationMessage } from '../validation-message.ts';

/**
 * The built-in `richText` field type: formatted text with links, stored as a JSON tree.
 *
 * The value is a `RichText`: blocks of runs, where a run carries marks and at most one link.
 * A write normalizes a well-shaped value into its canonical form, then checks it against the options.
 * A failure lands at its path inside the value, so `[2].content[0].link.url` names the exact run.
 * Each record link the value holds is a weak reference: a new one must exist and be within reach.
 * A link every matched record already holds is never checked, and deleting a target never blocks.
 * `min` and `max` bound the run text in characters, counted as UTF-16 units like `String#length`.
 * The value type is `RichText<C>`, where `C` is the union of the collections `links` names.
 * Word search never matches the value.
 */
export const richText = defineField({
  columnType: 'json',
  search: false,
  options: {
    /**
     * Whether the value holds at most one paragraph, rendered without a block tag.
     * `elements` does not apply then.
     *
     * @default
     * false
     */
    inline: option({ default: false }),

    /**
     * The block elements allowed besides paragraphs, by HTML name.
     *
     * @default
     * ['h2', 'h3', 'ul', 'ol', 'blockquote']
     */
    elements: option<readonly RichTextElement[]>({ default: RICH_TEXT_DEFAULT_ELEMENTS }),

    /**
     * The marks allowed on text, by HTML name.
     *
     * @default
     * ['strong', 'em', 'code']
     */
    marks: option<readonly RichTextMark[]>({ default: RICH_TEXT_DEFAULT_MARKS }),

    /**
     * The links allowed on text.
     * `false` allows none, `true` allows URLs, and a list of collections also allows records in them.
     *
     * @default
     * true
     */
    links: option<boolean | readonly CollectionName[]>({ default: true }),

    /**
     * Whether text keeps its line breaks.
     * With `false`, each `\n` becomes a space on write.
     *
     * @default
     * true
     */
    lineBreaks: option({ default: true }),

    /**
     * Whether an empty value is legal.
     * A rich text field rejects `[]` unless this is set, so it is non-empty by default.
     * A literal `default: []` without it is rejected at boot.
     *
     * @default
     * false
     */
    allowEmpty: option({ default: false }),

    /**
     * The fewest characters the run text may hold.
     */
    min: option<number>(),

    /**
     * The most characters the run text may hold.
     */
    max: option<number>(),
  },
  emitType: (ctx) =>
    `${ctx.importType('ohnejs/utils', 'RichText')}<${linksParameter(ctx.options.links)}>`,
  sanitizers: [(value, ctx) => (isRichText(value) ? normalizeRichText(value, ctx.options) : value)],
  validators: [
    (value, ctx) => {
      const { links, allowEmpty, min, max } = ctx.options;
      const issues = checkRichText(value, { ...ctx.options, links: registeredLinks(links) });
      if (issues.length > 0) return reportIssues(issues, ctx.errors);
      const tree = value as RichText;
      if (!allowEmpty && tree.length === 0) return 'validation.emptyValue';
      const length = richTextLength(tree);
      if (!isUndefined(min) && length < min) {
        return validationMessage('validation.minLength', { min });
      }
      if (!isUndefined(max) && length > max) {
        return validationMessage('validation.maxLength', { max });
      }
      return undefined;
    },
  ],
  links: (value) =>
    richTextLinks(value).flatMap(({ path, link }) => (isRecordLink(link) ? [{ path, link }] : [])),
});

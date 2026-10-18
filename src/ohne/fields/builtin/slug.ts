import { canonicalSlug, isUndefined, parseFieldPath } from '../../../utils/index.ts';
import { defineField } from '../define-field.ts';
import { option } from '../option.ts';

/**
 * The built-in `slug` field type: the URL-safe name of a record, like `about`, or `docs/install` when nested.
 *
 * A write stores the canonical form, lowercase Latin words joined by `-`: `Über uns` stores as `uber-uns`.
 * A flat slug folds `/` like any punctuation; a nested one keeps it between segments.
 * An input with no Latin letter or digit rejects with `validation.invalidSlug`.
 * `from` names a sibling the dashboard derives the slug from while you type; the server never derives.
 * Search finds a slug through the canonical form of the typed word.
 */
export const slug = defineField({
  columnType: 'text',
  options: {
    /**
     * Whether the slug may hold `/` between segments, like `docs/install`.
     *
     * @default
     * false
     */
    nested: option({ default: false }),

    /**
     * The field the dashboard derives the slug from while you type, as a field path in `when` syntax.
     * A new record follows it until you edit the slug yourself; an existing slug never follows on its own.
     *
     * @example
     * ```ts
     * 'title'
     * '../name'
     * ```
     */
    from: option<string>(),
  },
  sanitizers: [(value, ctx) => canonicalSlug(value, ctx.options)],
  validators: [(value) => (value === '' ? 'validation.invalidSlug' : undefined)],
  validateOptions: ({ options }) =>
    isUndefined(options.from) || !isUndefined(parseFieldPath(options.from))
      ? undefined
      : [
          `\`from\` is \`${options.from}\`, which is no field path.`,
          'Write it as `when` does: `title`, `../title` or `/title`.',
        ],
  search: ({ token, options }) => {
    const canonical = canonicalSlug(token, options);
    return canonical === '' ? null : { contains: canonical };
  },
});

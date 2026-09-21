import type { FieldInstance } from '../field.ts';
import type { FieldLayout } from '../layout.ts';

import { isArray, isUndefined } from '../../../utils/index.ts';
import { defineField } from '../define-field.ts';
import { option } from '../option.ts';
import { validationMessage } from '../validation-message.ts';

/**
 * The built-in `repeater` field type: an ordered list of nested field groups.
 *
 * Owns no column; its items live in a child table beside the owner, ordered per parent row.
 * The subfields are regular `field(...)` instances and may nest composites and relations further.
 * Each item keeps a stable `UUID`, and every item follows its parent: deleting the parent deletes them.
 */
export const repeater = defineField({
  columnType: false,
  options: {
    /**
     * The fields of one item, each a regular `field(...)` instance.
     */
    fields: option<Record<string, FieldInstance>>({ required: true }),

    /**
     * How the dashboard arranges one item's fields: rows, cards, tabs, and rules.
     * A field the layout does not name renders after it, in declaration order.
     * Omitted, the fields stack in declaration order.
     *
     * @example
     * ```ts
     * layout: [
     *   { row: ['label', 'url', 'newTab | auto'] },
     *   '---',
     *   { card: ['description'] },
     * ]
     * ```
     */
    layout: option<FieldLayout>(),

    /**
     * Whether an empty list is a legal value.
     * With `false`, supplying `[]` is rejected, so the field requires at least one item.
     *
     * @default
     * true
     */
    allowEmpty: option({ default: true }),

    /**
     * The fewest items a written list may hold.
     */
    min: option<number>(),

    /**
     * The most items a written list may hold.
     */
    max: option<number>(),
  },
  schema: (ctx) => ({
    kind: 'child',
    cardinality: 'many',
    subfields: ctx.options.fields,
  }),
  validators: [
    (value, ctx) =>
      !ctx.options.allowEmpty && isArray(value) && value.length === 0
        ? 'validation.emptyValue'
        : undefined,
    (value, ctx) => {
      if (!isArray(value)) return undefined;
      const { min, max } = ctx.options;
      if (!isUndefined(min) && value.length < min) {
        return validationMessage('validation.minItems', { min });
      }
      if (!isUndefined(max) && value.length > max) {
        return validationMessage('validation.maxItems', { max });
      }
      return undefined;
    },
  ],
});

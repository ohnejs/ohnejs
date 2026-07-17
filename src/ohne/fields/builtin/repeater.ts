import type { FieldInstance } from '../field.ts';

import { defineField } from '../define-field.ts';
import { option } from '../option.ts';

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
     * Whether an empty list is a legal value.
     * With `false`, supplying `[]` is rejected, so the field requires at least one item.
     * Absent input still defaults to `[]`; only a provided empty list is rejected.
     *
     * @default
     * true
     */
    allowEmpty: option({ default: true }),
  },
  schema: (ctx) => ({
    kind: 'child',
    cardinality: 'many',
    subfields: ctx.options.fields,
  }),
});

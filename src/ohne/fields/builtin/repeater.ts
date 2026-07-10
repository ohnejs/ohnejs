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
  },
  schema: (ctx) => ({
    kind: 'child',
    cardinality: 'many',
    subfields: ctx.options.fields,
  }),
});

import type { FieldInstance } from '../field.ts';

import { defineField } from '../define-field.ts';
import { option } from '../option.ts';

/**
 * The built-in `object` field type: a nested group of fields, stored at most once per parent row.
 *
 * Owns no column; its data lives in a child table beside the owner, one row per parent at most.
 * The subfields are regular `field(...)` instances and may nest composites and relations further.
 * The row follows its parent: deleting the parent deletes it.
 */
export const object = defineField({
  columnType: false,
  options: {
    /**
     * The object's fields, each a regular `field(...)` instance.
     */
    fields: option<Record<string, FieldInstance>>({ required: true }),
  },
  schema: (ctx) => ({
    kind: 'child',
    cardinality: 'one',
    subfields: ctx.options.fields,
  }),
});

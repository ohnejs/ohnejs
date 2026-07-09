import type { CollectionName } from '../../collections/known-collections.ts';

import { defineField } from '../define-field.ts';
import { option } from '../option.ts';

/**
 * The built-in `record` field type: a reference to one row of another collection.
 *
 * Stores the target row's `UUID` in a text column named after the field, with a foreign key.
 * The column is force-nullable: the target can be deleted out from under it (`setNull` default).
 * The column is indexed by default; `unique: true` upgrades that to a one-to-one constraint.
 */
export const record = defineField({
  columnType: 'text',
  forceNullable: true,
  forceIndex: true,
  options: {
    /**
     * The collection this field references, by name.
     */
    collection: option<CollectionName>({ required: true }),

    /**
     * What happens to this field when the referenced row is deleted.
     * `setNull` clears the reference, `cascade` deletes the referencing row, `restrict` blocks the delete.
     *
     * @default
     * 'setNull'
     */
    onDelete: option<'setNull' | 'cascade' | 'restrict'>(),
  },
  schema: (ctx) => ({
    kind: 'foreignKey',
    collection: ctx.options.collection,
    onDelete: ctx.options.onDelete,
  }),
});

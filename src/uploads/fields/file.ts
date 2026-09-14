import { defineField, option } from 'ohnejs';

import { checkUpload, fileOptions } from './_constraints.ts';

/**
 * The `file` field type: a reference to one uploaded file.
 *
 * Stores the `Uploads` row's `UUID` in a text column named after the field, with a foreign key.
 * The column is force-nullable: the upload can be deleted out from under it (`setNull` default).
 * The column is indexed by default; `unique: true` upgrades that to a one-to-one constraint.
 * The referenced row must be a file within the field's type and size bounds; a folder is rejected.
 * One read of the row on the write's transaction checks every bound.
 */
export default defineField({
  columnType: 'text',
  forceNullable: true,
  forceIndex: true,
  options: {
    ...fileOptions,

    /**
     * What happens to this field when the referenced upload is deleted.
     * `setNull` clears the reference, `cascade` deletes the referencing row, `restrict` blocks the delete.
     * The referencing row is whichever row holds the column: inside a repeater, the item, not its owner.
     *
     * @default
     * 'setNull'
     */
    onDelete: option<'setNull' | 'cascade' | 'restrict'>(),
  },
  schema: (ctx) => ({ kind: 'foreignKey', collection: 'Uploads', onDelete: ctx.options.onDelete }),
  validators: [(value, ctx) => checkUpload(value, ctx, false)],
});

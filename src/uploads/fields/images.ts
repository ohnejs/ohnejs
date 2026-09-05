import { defineField, option } from 'ohne';

import { checkListSize, checkUploadList, imageOptions, listOptions } from './_constraints.ts';

/**
 * The `images` field type: an ordered list of references to uploaded images.
 *
 * Owns no column; its links live in a junction table joining the owner and `Uploads` by `UUID`.
 * The list keeps the caller's order, and a (parent, upload) pair can exist only once.
 * Every referenced row must be an image file within the field's type, size, and pixel bounds.
 * One read of the rows on the write's transaction checks every item; a failing item keys at its index.
 */
export default defineField({
  columnType: false,
  options: {
    ...imageOptions,
    ...listOptions,

    /**
     * What happens to a link when its upload is deleted.
     * `cascade` removes the link, `restrict` blocks the delete while links exist.
     * Here `cascade` deletes only the link row; on `image` it deletes the referencing row itself.
     *
     * @default
     * 'cascade'
     */
    onDelete: option<'cascade' | 'restrict'>(),
  },
  schema: (ctx) => ({ kind: 'junction', collection: 'Uploads', onDelete: ctx.options.onDelete }),
  validators: [
    (value, ctx) => checkListSize(value, ctx.options),
    (value, ctx) => checkUploadList(value, ctx, true),
  ],
});

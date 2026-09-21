import type { CollectionName } from '../../collections/known-collections.ts';

import { isArray, isUndefined } from '../../../utils/index.ts';
import { defineField } from '../define-field.ts';
import { option } from '../option.ts';
import { validationMessage } from '../validation-message.ts';

/**
 * The built-in `records` field type: an ordered many-to-many relation to another collection.
 *
 * Owns no column; its links live in a junction table joining the owner and the target by `UUID`.
 * Each side of the junction keeps its own order, and a (parent, target) pair can exist only once.
 * With `inverse`, this field is the other side of an owning `records` field and creates no table.
 */
export const records = defineField({
  columnType: false,
  options: {
    /**
     * The collection this field relates to, by name.
     */
    collection: option<CollectionName>({ required: true }),

    /**
     * The owning `records` field on the target collection this field is the inverse of.
     * Both sides then share the owner's junction table, each keeping its own order.
     * Omitted, this field owns the junction itself.
     */
    inverse: option<string>(),

    /**
     * What happens to a link when its target row is deleted.
     * `cascade` removes the link, `restrict` blocks the delete while links exist.
     * Here `cascade` deletes only the link row; on `record` it deletes the referencing row itself.
     * Only the owning side configures this; an `inverse` field cannot.
     *
     * @default
     * 'cascade'
     */
    onDelete: option<'cascade' | 'restrict'>(),

    /**
     * Whether an empty list is a legal value.
     * With `false`, supplying `[]` is rejected, so the field requires at least one link.
     *
     * @default
     * true
     */
    allowEmpty: option({ default: true }),

    /**
     * The fewest links a written list may hold.
     */
    min: option<number>(),

    /**
     * The most links a written list may hold.
     */
    max: option<number>(),
  },
  schema: (ctx) => ({
    kind: 'junction',
    collection: ctx.options.collection,
    inverse: ctx.options.inverse,
    onDelete: ctx.options.onDelete,
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

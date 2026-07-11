import type { BlockName } from '../../blocks/known-blocks.ts';

import { defineField } from '../define-field.ts';
import { option } from '../option.ts';

/**
 * The built-in `blocks` field type: an ordered list of block instances.
 *
 * Owns no column; its references live in a wrapper table beside the owner, ordered per parent row.
 * Each wrapper row names its block type and instance; the instances live in shared `block_` tables.
 * Blocks nest freely: a block's own `blocks` field hangs a further wrapper off its per-type table.
 */
export const blocks = defineField({
  columnType: false,
  options: {
    /**
     * The block types this field may hold, by name.
     * Omitted means every registered block.
     */
    allow: option<readonly BlockName[]>(),
  },
  schema: (ctx) => ({
    kind: 'blocks',
    allow: ctx.options.allow,
  }),
});

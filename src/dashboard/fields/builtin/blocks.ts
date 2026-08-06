import { isArray } from '../../../utils/is/is-array.ts';
import { dimMark, type FieldCell, registerFieldCell } from '../field-cell.ts';

/**
 * The `blocks` field's sheet cell: a dim count of the block instances.
 * The blocks edit in a dedicated editor, not inline.
 */
export const blocksCell: FieldCell = {
  display({ value }) {
    return () => {
      const current = value();
      return dimMark(`[${isArray(current) ? current.length : 0}]`);
    };
  },
};

registerFieldCell('blocks', blocksCell);

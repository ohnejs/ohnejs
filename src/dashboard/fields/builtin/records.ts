import { isArray } from '../../../utils/is/is-array.ts';
import { dimMark, type FieldCell, registerFieldCell } from '../field-cell.ts';

/**
 * The `records` field's sheet cell: a dim count of the linked records.
 * The list edits in a dedicated editor, not inline.
 */
export const recordsCell: FieldCell = {
  display({ value }) {
    return () => {
      const current = value();
      return dimMark(`[${isArray(current) ? current.length : 0}]`);
    };
  },
};

registerFieldCell('records', recordsCell);

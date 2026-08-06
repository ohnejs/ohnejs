import { isArray } from '../../../utils/is/is-array.ts';
import { dimMark, type FieldCell, registerFieldCell } from '../field-cell.ts';

/**
 * The `repeater` field's sheet cell: a dim count of the items.
 * The items edit in a dedicated editor, not inline.
 */
export const repeaterCell: FieldCell = {
  display({ value }) {
    return () => {
      const current = value();
      return dimMark(`[${isArray(current) ? current.length : 0}]`);
    };
  },
};

registerFieldCell('repeater', repeaterCell);

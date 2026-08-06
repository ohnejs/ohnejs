import { isDecimalString } from '../../../utils/is/is-decimal-string.ts';
import { isInteger } from '../../../utils/is/is-integer.ts';
import { isNullish } from '../../../utils/is/is-nullish.ts';
import { cellEditor } from '../cell-editor.ts';
import { dimMark, type FieldCell, registerFieldCell } from '../field-cell.ts';

/**
 * The `integer` field's sheet cell: the number in tabular numerals, parsed strictly on edit.
 * A non-integer entry is rejected in place; an emptied editor writes `null` on a nullable field.
 */
export const integerCell: FieldCell = {
  display({ value }) {
    return () => {
      const current = value();
      return isNullish(current) ? dimMark('·') : String(current as number);
    };
  },
  editor({ field, value, commit, cancel }) {
    const current = value();
    return cellEditor({
      initial: isNullish(current) ? '' : String(current as number),
      commit(text) {
        if (text === '') {
          if (!field.nullable) return false;
          return commit(null);
        }
        if (!isDecimalString(text)) return false;
        const parsed = Number(text);
        if (!isInteger(parsed)) return false;
        return commit(parsed);
      },
      cancel,
    });
  },
};

registerFieldCell('integer', integerCell);

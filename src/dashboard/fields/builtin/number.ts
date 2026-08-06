import { isDecimalString } from '../../../utils/is/is-decimal-string.ts';
import { isNullish } from '../../../utils/is/is-nullish.ts';
import { isRealNumber } from '../../../utils/is/is-real-number.ts';
import { cellEditor } from '../cell-editor.ts';
import { dimMark, type FieldCell, registerFieldCell } from '../field-cell.ts';

/**
 * The `number` field's sheet cell: the finite double in tabular numerals, parsed strictly on edit.
 * A non-numeric entry is rejected in place; an emptied editor writes `null` on a nullable field.
 */
export const numberCell: FieldCell = {
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
        if (!isRealNumber(parsed)) return false;
        return commit(parsed);
      },
      cancel,
    });
  },
};

registerFieldCell('number', numberCell);

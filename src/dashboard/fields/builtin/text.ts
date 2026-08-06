import { isNullish } from '../../../utils/is/is-nullish.ts';
import { cellEditor } from '../cell-editor.ts';
import { dimMark, type FieldCell, registerFieldCell } from '../field-cell.ts';

/**
 * The `text` field's sheet cell: the string as-is, edited in place.
 * An emptied editor writes `null` on a nullable field, the empty string otherwise.
 */
export const textCell: FieldCell = {
  display({ value }) {
    return () => {
      const current = value();
      return isNullish(current) ? dimMark('·') : String(current as string);
    };
  },
  editor({ field, value, commit, cancel }) {
    const current = value();
    return cellEditor({
      initial: isNullish(current) ? '' : String(current as string),
      commit: (text) => commit(text === '' && field.nullable ? null : text),
      cancel,
    });
  },
};

registerFieldCell('text', textCell);

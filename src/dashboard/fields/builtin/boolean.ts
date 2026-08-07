import { isNullish } from '../../../utils/is/is-nullish.ts';
import { dimMark, type FieldCell, registerFieldCell } from '../field-cell.ts';

/**
 * The `boolean` field's sheet cell: a check mark for `true`, blank for `false`, a dim dot for `null`.
 * Editing toggles the value at once; there is no inline input.
 * A failed toggle closes back to the stored value.
 */
export const booleanCell: FieldCell = {
  display({ value }) {
    return () => {
      const current = value();
      if (isNullish(current)) return dimMark('·');
      return current === true ? '✓' : '';
    };
  },
  editor({ value, commit, cancel }) {
    void commit(value() !== true).then((landing) => {
      if (!landing.landed) cancel();
    });
    return null;
  },
};

registerFieldCell('boolean', booleanCell);

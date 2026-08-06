import { isNullish } from '../../../utils/is/is-nullish.ts';
import { dimMark, type FieldCell, registerFieldCell } from '../field-cell.ts';

/**
 * The `object` field's sheet cell: a dim mark for a present child, a dot for none.
 * The child edits in a dedicated editor, not inline.
 */
export const objectCell: FieldCell = {
  display({ value }) {
    return () => (isNullish(value()) ? dimMark('·') : dimMark('{…}'));
  },
};

registerFieldCell('object', objectCell);

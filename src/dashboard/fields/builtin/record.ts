import { isNullish } from '../../../utils/is/is-nullish.ts';
import { h } from '../../render/h.ts';
import { cellEditor } from '../cell-editor.ts';
import { dimMark, type FieldCell, registerFieldCell } from '../field-cell.ts';

/**
 * The `record` field's sheet cell: the target's `UUID` in the mono font.
 * Editing takes a `UUID` as text; an emptied editor unlinks with `null`.
 */
export const recordCell: FieldCell = {
  display({ value }) {
    return () => {
      const current = value();
      if (isNullish(current)) return dimMark('·');
      return h('span', { class: 'cell-mono' }, String(current as string));
    };
  },
  editor({ value, commit, cancel }) {
    const current = value();
    return cellEditor({
      initial: isNullish(current) ? '' : String(current as string),
      mono: true,
      commit: (text) => commit(text === '' ? null : text),
      cancel,
    });
  },
};

registerFieldCell('record', recordCell);

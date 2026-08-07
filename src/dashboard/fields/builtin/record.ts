import { isNullish } from '../../../utils/is/is-nullish.ts';
import { isUndefined } from '../../../utils/is/is-undefined.ts';
import { h } from '../../render/h.ts';
import { cellEditor } from '../cell-editor.ts';
import { dimMark, type FieldCell, registerFieldCell } from '../field-cell.ts';
import { recordPicker } from '../record-picker.ts';

/**
 * The `record` field's sheet cell: the target's `UUID` in the mono font.
 * Editing opens the search picker over the target collection.
 * When the target is unreadable or has no text field, a plain `UUID` editor stands in;
 * emptied, it unlinks with `null`.
 */
export const recordCell: FieldCell = {
  display({ value }) {
    return () => {
      const current = value();
      if (isNullish(current)) return dimMark('·');
      return h('span', { class: 'cell-mono' }, String(current as string));
    };
  },
  editor(context) {
    const picker = recordPicker(context);
    if (!isUndefined(picker)) return picker;
    const current = context.value();
    return cellEditor({
      initial: isNullish(current) ? '' : String(current as string),
      mono: true,
      commit: (text) => context.commit(text === '' ? null : text),
      cancel: context.cancel,
    });
  },
};

registerFieldCell('record', recordCell);

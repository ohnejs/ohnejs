import { first } from '../../../utils/array/first.ts';
import { isEmpty } from '../../../utils/is/is-empty.ts';
import { isNullish } from '../../../utils/is/is-nullish.ts';
import { isPlainObject } from '../../../utils/is/is-plain-object.ts';
import { isUndefined } from '../../../utils/is/is-undefined.ts';
import { ref } from '../../../utils/reactive/ref.ts';
import { h } from '../../render/h.ts';
import { useT } from '../../runtime/use-t.ts';
import { button } from '../../ui/button.ts';
import { drawer } from '../../ui/drawer.ts';
import { blocksOf } from '../_blocks.ts';
import { itemFormSupports } from '../_items.ts';
import { dimMark, type FieldCell, registerFieldCell } from '../field-cell.ts';
import { createItemForm, scopedErrors } from '../item-form.ts';

/**
 * The `object` field's sheet cell: a dim mark for a present child, a dot for none.
 * Editing opens a drawer over the child's subfields; the write replaces the child whole.
 * Clearing writes `null` and removes the child row.
 */
export const objectCell: FieldCell = {
  display({ value }) {
    return () => (isNullish(value()) ? dimMark('·') : dimMark('{…}'));
  },
  editor(context) {
    const subfields = context.field.subfields ?? [];
    if (subfields.length === 0 || !itemFormSupports(subfields, blocksOf())) return undefined;
    const t = useT();
    const current = context.value();
    const initial = isPlainObject<Record<string, unknown>>(current) ? current : undefined;
    const form = createItemForm(subfields, initial, { attachUUID: false });
    const busy = ref(false);
    const failure = ref('');

    const write = (value: unknown): void => {
      if (busy.value) return;
      busy.value = true;
      failure.value = '';
      void context.commit(value).then((landing) => {
        busy.value = false;
        if (landing.landed) return;
        if (isUndefined(landing.errors)) {
          failure.value = t('dashboard.writeFailed');
          return;
        }
        const scoped = scopedErrors(landing.errors, `${context.field.name}.`);
        const leftover = form.setErrors(scoped);
        failure.value =
          leftover !== ''
            ? leftover
            : isEmpty(scoped)
              ? (first(Object.values(landing.errors)) ?? '')
              : '';
      });
    };

    const save = (event: SubmitEvent): void => {
      event.preventDefault();
      const item = form.read();
      if (!isUndefined(item)) write(item);
    };

    return drawer(
      { title: () => context.field.label, onClose: context.cancel },
      h(
        'form',
        { onSubmit: save },
        form.render(),
        h('div', { class: 'ohne-item-failure' }, () => failure.value),
        h(
          'div',
          { class: 'ohne-item-actions' },
          button(() => t('dashboard.save'), { type: 'submit', disabled: () => busy.value }),
          isUndefined(initial)
            ? null
            : button(() => t('dashboard.clear'), {
                kind: 'ghost',
                disabled: () => busy.value,
                onClick: () => write(null),
              }),
        ),
      ),
    );
  },
};

registerFieldCell('object', objectCell);

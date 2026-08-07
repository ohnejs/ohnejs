import { isArray } from '../../../utils/is/is-array.ts';
import { isPlainObject } from '../../../utils/is/is-plain-object.ts';
import { isUndefined } from '../../../utils/is/is-undefined.ts';
import { ref } from '../../../utils/reactive/ref.ts';
import { each } from '../../render/each.ts';
import { h } from '../../render/h.ts';
import { useT } from '../../runtime/use-t.ts';
import { button } from '../../ui/button.ts';
import { drawer } from '../../ui/drawer.ts';
import { dimMark, type FieldCell, registerFieldCell } from '../field-cell.ts';
import { createItemForm, type ItemForm, itemFormSupports, scopedErrors } from '../item-form.ts';

/**
 * One drawer row: a stable local key and the item's form.
 */
interface RepeaterEntry {
  key: number;
  form: ItemForm;
}

/**
 * The `repeater` field's sheet cell: a dim count of the items.
 * Editing opens a drawer listing every item as a form, with add, remove, and reorder.
 * Saving writes the whole list: kept items carry their `UUID`, removed ones delete.
 */
export const repeaterCell: FieldCell = {
  display({ value }) {
    return () => {
      const current = value();
      return dimMark(`[${isArray(current) ? current.length : 0}]`);
    };
  },
  editor(context) {
    const subfields = context.field.subfields ?? [];
    if (subfields.length === 0 || !itemFormSupports(subfields)) return undefined;
    const t = useT();
    let nextKey = 0;
    const initial = isArray(context.value()) ? (context.value() as unknown[]) : [];
    const entries = ref<readonly RepeaterEntry[]>(
      initial
        .filter((item) => isPlainObject<Record<string, unknown>>(item))
        .map((item) => ({
          key: (nextKey += 1),
          form: createItemForm(subfields, item, { attachUUID: true }),
        })),
    );
    const busy = ref(false);
    const failure = ref('');

    const add = (): void => {
      entries.value = [
        ...entries.value,
        { key: (nextKey += 1), form: createItemForm(subfields, undefined, { attachUUID: true }) },
      ];
    };

    const remove = (key: number): void => {
      entries.value = entries.value.filter((entry) => entry.key !== key);
    };

    const move = (key: number, delta: -1 | 1): void => {
      const list = [...entries.value];
      const from = list.findIndex((entry) => entry.key === key);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= list.length) return;
      const [entry] = list.splice(from, 1);
      list.splice(to, 0, entry as RepeaterEntry);
      entries.value = list;
    };

    const save = (event: SubmitEvent): void => {
      event.preventDefault();
      if (busy.value) return;
      const sent = entries.value;
      const items: Record<string, unknown>[] = [];
      let invalid = false;
      for (const entry of sent) {
        const item = entry.form.read();
        if (isUndefined(item)) invalid = true;
        else items.push(item);
      }
      if (invalid) return;
      busy.value = true;
      failure.value = '';
      void context.commit(items).then((landing) => {
        busy.value = false;
        if (landing.landed) return;
        if (isUndefined(landing.errors)) {
          failure.value = t('dashboard.writeFailed');
          return;
        }
        let leftover = '';
        let placed = 0;
        sent.forEach((entry, index) => {
          const scoped = scopedErrors(landing.errors ?? {}, `${context.field.name}[${index}].`);
          placed += Object.keys(scoped).length;
          const unplaced = entry.form.setErrors(scoped);
          if (leftover === '' && unplaced !== '') leftover = unplaced;
        });
        failure.value =
          leftover !== '' ? leftover : placed === 0 ? (Object.values(landing.errors)[0] ?? '') : '';
      });
    };

    return drawer(
      { title: () => context.field.label, onClose: context.cancel },
      h(
        'form',
        { onSubmit: save },
        each(
          () => entries.value,
          (entry) => entry.key,
          (entry, index) =>
            h(
              'div',
              { class: 'ohne-item' },
              h(
                'div',
                { class: 'ohne-item-bar' },
                h('span', { class: 'ohne-caps' }, () => String(index() + 1)),
                button('↑', {
                  kind: 'ghost',
                  disabled: () => busy.value || index() === 0,
                  onClick: () => move(entry().key, -1),
                }),
                button('↓', {
                  kind: 'ghost',
                  disabled: () => busy.value || index() === entries.value.length - 1,
                  onClick: () => move(entry().key, 1),
                }),
                button('✕', {
                  kind: 'ghost',
                  disabled: () => busy.value,
                  onClick: () => remove(entry().key),
                }),
              ),
              entry().form.render(),
            ),
        ),
        h(
          'div',
          { class: 'ohne-item-actions' },
          button(() => t('dashboard.addItem'), {
            kind: 'ghost',
            disabled: () => busy.value,
            onClick: add,
          }),
        ),
        h('div', { class: 'ohne-item-failure' }, () => failure.value),
        h(
          'div',
          { class: 'ohne-item-actions' },
          button(() => t('dashboard.save'), { type: 'submit', disabled: () => busy.value }),
        ),
      ),
    );
  },
};

registerFieldCell('repeater', repeaterCell);

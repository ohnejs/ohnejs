import { isArray } from '../../../utils/is/is-array.ts';
import { isString } from '../../../utils/is/is-string.ts';
import { isUndefined } from '../../../utils/is/is-undefined.ts';
import { ref } from '../../../utils/reactive/ref.ts';
import { css } from '../../render/css.ts';
import { each } from '../../render/each.ts';
import { h } from '../../render/h.ts';
import { useT } from '../../runtime/use-t.ts';
import { button } from '../../ui/button.ts';
import { drawer } from '../../ui/drawer.ts';
import { createTargetSearch, labelFieldOf, rowLabel, targetOf } from '../_search.ts';
import { dimMark, type FieldCell, registerFieldCell } from '../field-cell.ts';

css`
  .ohne-links-row {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 3px 0;
    border-bottom: 1px solid var(--hairline);
  }

  .ohne-links-row .cell-mono {
    margin-right: auto;
  }

  .ohne-links-search {
    margin: 16px 0 4px;
  }

  .ohne-links-result {
    padding: 5px 10px;
    white-space: nowrap;
    cursor: default;
  }

  .ohne-links-result:hover {
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }
`;

/**
 * The `records` field's sheet cell: a dim count of the linked records.
 * Editing opens a drawer over the ordered links: search to add, remove, and reorder.
 * Saving writes the whole `UUID` list; the target must be readable to search it.
 */
export const recordsCell: FieldCell = {
  display({ value }) {
    return () => {
      const current = value();
      return dimMark(`[${isArray(current) ? current.length : 0}]`);
    };
  },
  editor(context) {
    const target = targetOf(context.field);
    if (isUndefined(target)) return undefined;
    const label = labelFieldOf(target);
    if (isUndefined(label)) return undefined;
    const t = useT();
    const links = ref<readonly string[]>(
      isArray(context.value()) ? (context.value() as unknown[]).filter(isString) : [],
    );
    const search = createTargetSearch(target, label);
    const busy = ref(false);
    const failure = ref('');
    search.prime();

    const append = (uuid: string): void => {
      if (!links.value.includes(uuid)) links.value = [...links.value, uuid];
    };

    const remove = (uuid: string): void => {
      links.value = links.value.filter((link) => link !== uuid);
    };

    const move = (uuid: string, delta: -1 | 1): void => {
      const list = [...links.value];
      const from = list.indexOf(uuid);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= list.length) return;
      const [link] = list.splice(from, 1);
      list.splice(to, 0, link as string);
      links.value = list;
    };

    const save = (): void => {
      if (busy.value) return;
      busy.value = true;
      failure.value = '';
      void context.commit(links.value).then((landing) => {
        busy.value = false;
        if (landing.landed) return;
        const message = Object.values(landing.errors ?? {})[0];
        failure.value = message ?? t('dashboard.writeFailed');
      });
    };

    const input = h('input', {
      class: 'ohne-input ohne-links-search',
      type: 'text',
      placeholder: label.label,
    }) as HTMLInputElement;
    input.addEventListener('input', () => search.search(input.value));
    queueMicrotask(() => input.focus());

    return drawer(
      { title: () => context.field.label, onClose: context.cancel },
      each(
        () => links.value,
        (link) => link,
        (link, index) =>
          h(
            'div',
            { class: 'ohne-links-row' },
            h('span', { class: 'cell-mono' }, () => link()),
            button('↑', {
              kind: 'ghost',
              disabled: () => index() === 0,
              onClick: () => move(link(), -1),
            }),
            button('↓', {
              kind: 'ghost',
              disabled: () => index() === links.value.length - 1,
              onClick: () => move(link(), 1),
            }),
            button('✕', { kind: 'ghost', onClick: () => remove(link()) }),
          ),
      ),
      input,
      h(
        'div',
        null,
        each(
          () =>
            search.rows().filter((row) => isString(row.UUID) && !links.value.includes(row.UUID)),
          (row, index) => String(row.UUID ?? index),
          (row) =>
            h(
              'div',
              {
                class: 'ohne-links-result',
                onMousedown: (event: MouseEvent) => {
                  event.preventDefault();
                  const uuid = row().UUID;
                  if (isString(uuid)) append(uuid);
                },
              },
              () => rowLabel(row(), label.name),
            ),
        ),
      ),
      h('div', { class: 'ohne-item-failure' }, () => failure.value),
      h(
        'div',
        { class: 'ohne-item-actions' },
        button(() => t('dashboard.save'), { disabled: () => busy.value, onClick: save }),
      ),
    );
  },
};

registerFieldCell('records', recordsCell);

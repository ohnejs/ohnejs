import type { Child } from '../render/insert.ts';
import type { FieldEditorContext } from './field-cell.ts';

import { isNullish } from '../../utils/is/is-nullish.ts';
import { isString } from '../../utils/is/is-string.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { clamp } from '../../utils/number/clamp.ts';
import { ref } from '../../utils/reactive/ref.ts';
import { css } from '../render/css.ts';
import { each } from '../render/each.ts';
import { h } from '../render/h.ts';
import { createTargetSearch, labelFieldOf, rowLabel, targetOf } from './_search.ts';

css`
  .ohne-picker {
    position: relative;
  }

  .ohne-picker-list {
    position: absolute;
    top: 100%;
    left: 0;
    min-width: 100%;
    max-height: 240px;
    overflow-y: auto;
    z-index: 5;
    background: var(--paper);
    border: 1px solid var(--hairline);
  }

  .ohne-picker-row {
    padding: 5px 10px;
    white-space: nowrap;
    cursor: default;
  }

  .ohne-picker-row.highlighted {
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }

  .ohne-picker-row .cell-dim {
    color: var(--dim);
  }
`;

/**
 * The `record` field's search picker: type to search the target collection, pick to link.
 * Search matches the target's first plain text field; arrows move, Enter links, Escape cancels.
 * A dim `·` row unlinks a nullable value.
 * Resolves `undefined` when the user cannot read the target or it has no searchable text field,
 * so the caller falls back to a plain `UUID` editor.
 */
export function recordPicker(context: FieldEditorContext): Child | undefined {
  const target = targetOf(context.field);
  if (isUndefined(target)) return undefined;
  const label = labelFieldOf(target);
  if (isUndefined(label)) return undefined;

  const search = createTargetSearch(target, label);
  const highlighted = ref(0);
  let picking = false;
  search.prime();

  const pick = (uuid: string | null): void => {
    picking = true;
    void context.commit(uuid).then((landing) => {
      if (!landing.landed) picking = false;
    });
  };

  const input = h('input', {
    class: 'cell-editor',
    type: 'text',
    placeholder: isNullish(context.value()) ? undefined : String(context.value() as string),
  }) as HTMLInputElement;
  input.addEventListener('input', () => {
    highlighted.value = 0;
    search.search(input.value);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      highlighted.value = clamp(
        highlighted.value + delta,
        0,
        Math.max(0, search.rows().length - 1),
      );
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const row = search.rows()[highlighted.value];
      if (!isUndefined(row) && isString(row.UUID)) pick(row.UUID);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      context.cancel();
    }
  });
  input.addEventListener('blur', () => {
    if (!picking) context.cancel();
  });
  queueMicrotask(() => input.focus());

  return h(
    'div',
    { class: 'ohne-picker' },
    input,
    h(
      'div',
      { class: 'ohne-picker-list' },
      isNullish(context.value()) || !context.field.nullable
        ? null
        : h(
            'div',
            {
              class: 'ohne-picker-row',
              onMousedown: (event: MouseEvent) => {
                event.preventDefault();
                pick(null);
              },
            },
            h('span', { class: 'cell-dim' }, '·'),
          ),
      each(
        () => search.rows(),
        (row, index) => String(row.UUID ?? index),
        (row, index) =>
          h(
            'div',
            {
              class: () => `ohne-picker-row${highlighted.value === index() ? ' highlighted' : ''}`,
              onMousedown: (event: MouseEvent) => {
                event.preventDefault();
                const uuid = row().UUID;
                if (isString(uuid)) pick(uuid);
              },
            },
            () => rowLabel(row(), label.name),
          ),
      ),
    ),
  );
}

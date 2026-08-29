import type { Primitive } from '../../ui/button-group.ts';

import { isArray } from '../../../utils/is/is-array.ts';
import { isNull } from '../../../utils/is/is-null.ts';
import { isString } from '../../../utils/is/is-string.ts';
import { isUndefined } from '../../../utils/is/is-undefined.ts';
import { deepEqual } from '../../../utils/object/deep-equal.ts';
import { effect } from '../../../utils/reactive/effect.ts';
import { ref } from '../../../utils/reactive/ref.ts';
import { untracked } from '../../../utils/reactive/untracked.ts';
import { css } from '../../render/css.ts';
import { h } from '../../render/h.ts';
import { useT } from '../../runtime/use-t.ts';
import { dynamicChips } from '../../ui/dynamic-chips.ts';
import { labelFieldOf, targetOf } from '../_search.ts';
import { describeControl } from '../field-row.ts';
import { dimMark, type FieldType, registerFieldType } from '../field-type.ts';
import { labelOf } from '../labels.ts';
import { recordChoiceSource } from './record.ts';

css`
  .ohne-records-field {
    align-items: flex-start;
  }
`;

/**
 * The `records` field's dashboard behaviour, its form control ported from Pruvious v4's `Records`.
 *
 * Cells summarize the ordered links as the first record's label plus a dim `+n` tail.
 * There is no inline cell editor: the list edits on the record page and in the edit popup.
 * The form control is the async `dynamicChips` field over the target's records.
 * Chips remove and drag-reorder, the dropdown searches and paginates, a double-click opens the record.
 * Server messages keyed by index mark their chips destructive, as the source's `erroredItems`.
 */
export const recordsType: FieldType = {
  display({ field, value }) {
    return () => {
      const current = value();
      const links = isArray(current) ? current.filter(isString) : [];
      if (links.length === 0) return dimMark('·');
      const first = links[0] as string;
      const resolved = labelOf(field.target ?? '', first);
      return [
        isUndefined(resolved)
          ? h('span', { class: 'cell-mono cell-dim' }, first.slice(0, 8))
          : h('span', { class: 'ohne-truncate', title: first }, resolved),
        links.length > 1 ? dimMark(` +${links.length - 1}`) : null,
      ];
    };
  },
  control(context) {
    const target = untracked(() => targetOf(context.field));
    const label = isUndefined(target) ? undefined : labelFieldOf(target);
    if (isUndefined(target) || isUndefined(label)) return undefined;
    const t = useT();
    const source = recordChoiceSource(target, label);

    let base = listOf(context.initial);
    const model = ref<Primitive[]>([...base]);
    const touched = ref(false);
    const routed = ref('');
    const erroredIndices = ref<number[]>([]);

    // The chips write the model directly on add, remove, and reorder; this relays every write
    // after the first into the control's change bookkeeping. `silent` mutes revert and rebase.
    let silent = true;
    effect(() => {
      void model.value;
      if (silent) return;
      untracked(() => {
        touched.value = true;
        routed.value = '';
        erroredIndices.value = [];
        context.onInput();
      });
    });
    silent = false;

    const reset = (next: readonly string[]): void => {
      silent = true;
      model.value = [...next];
      silent = false;
      touched.value = false;
      routed.value = '';
      erroredIndices.value = [];
    };

    const chips = dynamicChips(model, {
      disabled: () => context.disabled === true,
      choicesResolver: source.choicesResolver,
      selectedChoicesResolver: (values) => source.choicesOf(values.map(String)),
      error: () => routed.value !== '',
      erroredItems: () => erroredIndices.value,
      name: context.path,
      noResultsLabel: untracked(() => t('dashboard.noResultsFound')),
      removeItemLabel: untracked(() => t('dashboard.removeItem')),
      onDblclick: (value) => {
        window.open(`/collections/${target.segment}/${String(value)}`, '_blank');
      },
    });
    const input = chips.querySelector<HTMLInputElement>('.ohne-dynamic-chips-input');
    if (!isNull(input)) describeControl(input, context.field, context.path, () => routed.value);

    return {
      element: h('div', { class: 'ohne-records-field ohne-row' }, chips),
      read() {
        if (!touched.value && isUndefined(context.initial)) return {};
        return { value: model.value };
      },
      setErrors(errors) {
        routed.value = errors[''] ?? '';
        const marked: number[] = [];
        let unplaced = '';
        for (const [key, message] of Object.entries(errors)) {
          if (key === '') continue;
          const match = /^\[(\d+)\]$/.exec(key);
          if (isNull(match)) {
            if (unplaced === '') unplaced = message;
          } else {
            marked.push(Number(match[1]));
          }
        }
        erroredIndices.value = marked;
        return unplaced;
      },
      error: () => routed.value,
      errored: () => erroredIndices.value.length > 0,
      dirty: () => touched.value && !deepEqual(model.value, base),
      focus: () => input?.focus(),
      revert() {
        reset(base);
      },
      rebase(value) {
        base = listOf(value);
        reset(base);
      },
    };
  },
};

/**
 * The stored value as a `UUID` list, malformed entries dropped.
 */
function listOf(value: unknown): readonly string[] {
  return isArray(value) ? value.filter(isString) : [];
}

registerFieldType('records', recordsType);

import type { Ref } from '../../../utils/reactive/ref.ts';
import type { DashboardField } from '../../runtime/meta-types.ts';
import type { Primitive } from '../../ui/button-group.ts';

import { first } from '../../../utils/array/first.ts';
import { isArray } from '../../../utils/is/is-array.ts';
import { isNull } from '../../../utils/is/is-null.ts';
import { isNumber } from '../../../utils/is/is-number.ts';
import { isPlainObject } from '../../../utils/is/is-plain-object.ts';
import { isString } from '../../../utils/is/is-string.ts';
import { isUndefined } from '../../../utils/is/is-undefined.ts';
import { deepEqual } from '../../../utils/object/deep-equal.ts';
import { effect } from '../../../utils/reactive/effect.ts';
import { ref } from '../../../utils/reactive/ref.ts';
import { untracked } from '../../../utils/reactive/untracked.ts';
import { h } from '../../render/h.ts';
import { translateMessage, useT } from '../../runtime/use-t.ts';
import { type ChipsChoice, chips } from '../../ui/chips.ts';
import { select, type SelectChoice } from '../../ui/select.ts';
import { textInput } from '../../ui/text-input.ts';
import { describeControl } from '../field-row.ts';
import { dimMark, type FieldType, registerFieldType } from '../field-type.ts';

/**
 * The `multiSelect` field type: cell display, form control, and filter.
 * The cell joins up to three resolved labels; a longer list shows the first with a dim `+n` mark.
 * An empty list shows as a dim hyphen.
 * The control is the chips input: choice-restricted when the field declares `choices`, free entry otherwise.
 * A declared `max` caps how many entries the chips accept.
 * Server errors keyed `[n]` mark the offending chips.
 * The edit popup owns editing, so the cell offers no inline editor.
 * The filter probes entries by `includes`, through the choices or free text.
 */
export const multiSelectType: FieldType = {
  display({ field, value }) {
    return () => {
      const current = value();
      const values = isArray(current) ? current.filter(isString) : [];
      if (values.length === 0) return dimMark('-');
      const pairs = choicesOf(field);
      const labels = values.map(
        (entry) => pairs.find((pair) => pair.value === entry)?.label ?? entry,
      );
      const joined = values.length <= 3 ? labels.join(', ') : (labels[0] as string);
      return [
        h('span', { class: 'ohne-truncate', title: joined }, joined),
        values.length > 3 ? dimMark(` +${values.length - 1}`) : null,
      ];
    };
  },
  control(context) {
    const t = useT();
    let base = listOf(context.initial);
    const model = ref<string[]>([...base]);
    const touched = ref(false);
    const routed = ref('');
    const erroredIndices = ref<number[]>([]);

    // The chips write `model` directly; `silent` mutes the effect's first run, revert, and rebase.
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

    const max = context.field.options?.max;
    const element = chips(model, {
      disabled: () => context.disabled === true,
      choices: isArray(context.field.options?.choices)
        ? (): ChipsChoice[] => choicesOf(context.field)
        : undefined,
      maxItems: isNumber(max) ? max : undefined,
      placeholder: context.field.placeholder,
      error: () => routed.value !== '',
      erroredItems: () => erroredIndices.value,
      name: context.path,
      noResultsLabel: untracked(() => t('dashboard.noResultsFound')),
      removeItemLabel: untracked(() => t('dashboard.removeItem')),
    });
    const input = element.querySelector<HTMLInputElement>('.ohne-chips-input');
    if (!isNull(input)) describeControl(input, context.field, context.path, () => routed.value);

    return {
      element,
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
  filter: {
    operators: () => ['includes', 'notIncludes'],
    seed: (field) => first(choicesOf(field))?.value ?? '',
    input({ field, value, set, commit, inputID }) {
      const t = useT();
      if (isArray(field.options?.choices)) {
        const bridged: Ref<Primitive> = {
          get value() {
            return value();
          },
          set value(next) {
            commit(String(next));
          },
        };
        return select(bridged, (): SelectChoice[] => choicesOf(field), {
          id: inputID,
          name: inputID,
        });
      }
      const bridged: Ref<string> = {
        get value() {
          return String(value());
        },
        set value(next) {
          set(next);
        },
      };
      return textInput(bridged, {
        id: inputID,
        name: inputID,
        placeholder: () => t('dashboard.filter.empty'),
        onBlur: () => commit(),
      });
    },
  },
};

/**
 * The declared `choices` option as resolved `value`/`label` pairs.
 * A plain string choice is its own display text; a declared label translates as a message.
 * A malformed or absent option resolves to no choices.
 */
function choicesOf(field: DashboardField): { value: string; label: string }[] {
  const declared = field.options?.choices;
  if (!isArray(declared)) return [];
  const pairs: { value: string; label: string }[] = [];
  for (const entry of declared) {
    if (isString(entry)) {
      pairs.push({ value: entry, label: entry });
    } else if (isPlainObject(entry) && isString(entry.value)) {
      pairs.push({ value: entry.value, label: translateMessage(entry.label) ?? entry.value });
    }
  }
  return pairs;
}

/**
 * The stored value as a string list, malformed entries dropped.
 */
function listOf(value: unknown): readonly string[] {
  return isArray(value) ? value.filter(isString) : [];
}

registerFieldType('multiSelect', multiSelectType);

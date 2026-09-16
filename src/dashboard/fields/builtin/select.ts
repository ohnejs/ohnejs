import type { Ref } from '../../../utils/reactive/ref.ts';
import type { DashboardField } from '../../runtime/meta-types.ts';
import type { Primitive } from '../../ui/button-group.ts';

import { first } from '../../../utils/array/first.ts';
import { isArray } from '../../../utils/is/is-array.ts';
import { isNull } from '../../../utils/is/is-null.ts';
import { isNullish } from '../../../utils/is/is-nullish.ts';
import { isPlainObject } from '../../../utils/is/is-plain-object.ts';
import { isString } from '../../../utils/is/is-string.ts';
import { isUndefined } from '../../../utils/is/is-undefined.ts';
import { ref } from '../../../utils/reactive/ref.ts';
import { h } from '../../render/h.ts';
import { translateMessage } from '../../runtime/use-t.ts';
import { select, type SelectChoice } from '../../ui/select.ts';
import { describeControl } from '../field-row.ts';
import { dimMark, type FieldType, registerFieldType } from '../field-type.ts';

/**
 * The `select` field type: cell display, form control, and filter.
 * The cell shows the stored value's resolved choice label, or the raw value when no choice matches.
 * A nullish value shows as a dim hyphen.
 * The control is the select combobox over the declared choices.
 * A nullable field leads with a muted `-` choice that writes `null`.
 * It stays pristine until touched, so an untouched control reads back the stored value unchanged.
 * The edit popup owns editing, so the cell offers no inline editor.
 * The filter compares by identity over the same choices.
 */
export const selectType: FieldType = {
  display({ field, value }) {
    return () => {
      const current = value();
      if (isNullish(current)) return dimMark('-');
      const raw = String(current as string);
      const match = choicesOf(field).find((choice) => choice.value === raw);
      return h('span', { class: 'ohne-truncate', title: raw }, match?.label ?? raw);
    };
  },
  control({ field, initial, path, disabled, onInput }) {
    let base = initial;
    const model = ref<Primitive>(isString(base) ? base : null);
    const touched = ref(false);
    const routed = ref('');

    const error = (): string => routed.value;
    const current = (): string | null => (isString(model.value) ? model.value : null);
    const entries = (): SelectChoice[] => {
      const pairs: SelectChoice[] = choicesOf(field);
      return field.nullable ? [{ value: null, label: '-', muted: true }, ...pairs] : pairs;
    };

    const element = select(model, entries, {
      disabled: () => disabled === true,
      error: () => routed.value !== '',
      name: path,
      placeholder: field.placeholder,
      // `onCommit` runs before the select writes the model; writing here lets the history push see it.
      onCommit: (next) => {
        model.value = isString(next) ? next : null;
        touched.value = true;
        routed.value = '';
        onInput();
      },
    });
    const combobox = element.querySelector<HTMLElement>('[role="combobox"]');
    if (!isNull(combobox)) describeControl(combobox, field, path, error);

    const wire = (): unknown => {
      const value = touched.value ? current() : isNullish(base) ? null : String(base as string);
      return field.nullable ? value : (value ?? '');
    };

    return {
      element,
      read() {
        if (!touched.value && isUndefined(base)) return {};
        return { value: wire() };
      },
      setErrors(errors) {
        routed.value = errors[''] ?? '';
        for (const [key, message] of Object.entries(errors)) {
          if (key !== '') return message;
        }
        return '';
      },
      error,
      dirty() {
        return touched.value && wire() !== (isUndefined(base) ? undefined : (base ?? null));
      },
      focus() {
        combobox?.focus();
      },
      revert() {
        model.value = isString(base) ? base : null;
        touched.value = false;
        routed.value = '';
      },
      rebase(value) {
        base = value;
        model.value = isString(value) ? value : null;
        touched.value = false;
        routed.value = '';
      },
    };
  },
  filter: {
    operators: () => ['eq', 'ne'],
    seed: (field) => first(choicesOf(field))?.value ?? '',
    input({ field, value, commit, inputID }) {
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

registerFieldType('select', selectType);

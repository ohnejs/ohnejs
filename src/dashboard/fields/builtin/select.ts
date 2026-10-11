import type { Ref } from '../../../utils/reactive/ref.ts';
import type { Primitive } from '../../ui/button-group.ts';
import type { SelectFieldOptions } from '../known-field-types.ts';

import { first } from '../../../utils/array/first.ts';
import { isArray } from '../../../utils/is/is-array.ts';
import { isNull } from '../../../utils/is/is-null.ts';
import { isNullish } from '../../../utils/is/is-nullish.ts';
import { isString } from '../../../utils/is/is-string.ts';
import { isUndefined } from '../../../utils/is/is-undefined.ts';
import { ref } from '../../../utils/reactive/ref.ts';
import { checkChoice } from '../../../utils/validate/check-choice.ts';
import { h } from '../../render/h.ts';
import { buttonGroup } from '../../ui/button-group.ts';
import { select, type SelectChoice } from '../../ui/select.ts';
import { checkedReading } from '../_checked-reading.ts';
import { describeControl, fieldPlaceholder } from '../field-row.ts';
import { dimMark, type FieldType, registerFieldType } from '../field-type.ts';
import { choicesOf } from './_choices.ts';

/**
 * The `select` field type: cell display, form control, and filter.
 * The cell shows the stored value's resolved choice label, or the raw value when no choice matches.
 * A nullish value shows as a dim hyphen.
 * The control is the select combobox over the declared choices, or a button group under `display: 'buttons'`.
 * A nullable field leads with a `-` choice that writes `null`.
 * It stays pristine until touched, so an untouched control reads back the stored value unchanged.
 * The edit popup owns editing, so the cell offers no inline editor.
 * The filter compares by identity over the same choices.
 * A changed value is checked against the choices, with the server's message.
 */
export const selectType: FieldType<SelectFieldOptions> = {
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

    const commit = (next: Primitive): void => {
      model.value = isString(next) ? next : null;
      touched.value = true;
      routed.value = '';
      onInput();
    };

    let element: HTMLElement;
    let proxy: HTMLElement | null;
    if (field.options?.display === 'buttons') {
      const bridged: Ref<Primitive> = {
        get value() {
          return model.value;
        },
        set value(next) {
          commit(next);
        },
      };
      element = buttonGroup(bridged, {
        choices: entries,
        variant: 'accent',
        disabled: () => disabled === true,
        name: path,
      });
      proxy = element;
    } else {
      element = select(model, entries, {
        disabled: () => disabled === true,
        name: path,
        placeholder: fieldPlaceholder(field),
        // `onCommit` runs before the select writes the model; writing here lets the history push see it.
        onCommit: commit,
      });
      proxy = element.querySelector<HTMLElement>('[role="combobox"]');
    }
    if (!isNull(proxy)) describeControl(proxy, field, path, error);

    const wire = (): unknown => {
      const value = touched.value ? current() : isNullish(base) ? null : String(base as string);
      return field.nullable ? value : (value ?? '');
    };

    const dirty = (): boolean =>
      touched.value && wire() !== (isUndefined(base) ? undefined : (base ?? null));

    return {
      element,
      read() {
        if (!touched.value && isUndefined(base)) return {};
        const value = wire();
        const choices = field.options?.choices;
        return checkedReading(
          value,
          isString(value) && isArray(choices) && dirty() ? checkChoice(value, choices) : undefined,
        );
      },
      setErrors(errors) {
        routed.value = errors[''] ?? '';
        for (const [key, message] of Object.entries(errors)) {
          if (key !== '') return message;
        }
        return '';
      },
      error,
      dirty,
      focus() {
        proxy?.focus();
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

registerFieldType('select', selectType);

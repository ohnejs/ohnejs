import type { Ref } from '../../../utils/reactive/ref.ts';

import { isNullish } from '../../../utils/is/is-nullish.ts';
import { isUndefined } from '../../../utils/is/is-undefined.ts';
import { ref } from '../../../utils/reactive/ref.ts';
import { h } from '../../render/h.ts';
import { useT } from '../../runtime/use-t.ts';
import { numberInput } from '../../ui/number-input.ts';
import { textInput } from '../../ui/text-input.ts';
import { cellEditor } from '../cell-editor.ts';
import { describeControl } from '../field-row.ts';
import { dimMark, type FieldType, registerFieldType } from '../field-type.ts';
import { parseRealValue } from '../parse.ts';

/**
 * The `number` field type: cell display, inline cell editor, form control, and filter.
 * The editor and control parse entry strictly to a finite double.
 * An emptied editor or control writes `null` on a nullable field; a non-nullable one omits.
 * The control validates on blur and on read.
 */
export const numberType: FieldType = {
  display({ value }) {
    return () => {
      const current = value();
      if (isNullish(current)) return dimMark('-');
      const text = String(current as number);
      return h('span', { class: 'ohne-truncate', title: text }, text);
    };
  },
  editor({ field, value, commit, cancel }) {
    const current = value();
    return cellEditor({
      initial: isNullish(current) ? '' : String(current as number),
      commit(text) {
        const parsed = parseRealValue(field, text);
        if (!isUndefined(parsed.error) || isUndefined(parsed.value)) return false;
        return commit(parsed.value);
      },
      cancel,
    });
  },
  control({ field, initial, path, disabled, onInput }) {
    const t = useT();
    const off = disabled === true;
    const base = ref(initial);
    const raw = ref(isNullish(initial) ? '' : String(initial as number));
    const local = ref('');
    const routed = ref('');

    const error = (): string => (routed.value !== '' ? routed.value : local.value);
    const touch = (): void => {
      local.value = '';
      routed.value = '';
      onInput();
    };

    const control = textInput(raw, { disabled: () => off, placeholder: field.placeholder });
    const input = control.querySelector('input') as HTMLInputElement;
    control.classList.add('ohne-input-numeric');
    input.setAttribute('inputmode', 'decimal');
    input.addEventListener('input', touch);
    input.addEventListener('blur', () => {
      const parsed = parseRealValue(field, raw.value);
      local.value = isUndefined(parsed.error) ? '' : t(parsed.error);
    });
    describeControl(input, field, path, error);

    return {
      element: control,
      read() {
        if (isUndefined(base.value) && raw.value.trim() === '') return {};
        const parsed = parseRealValue(field, raw.value);
        if (!isUndefined(parsed.error)) {
          const message = t(parsed.error);
          local.value = message;
          return { errors: { '': message } };
        }
        local.value = '';
        return isUndefined(parsed.value) ? {} : { value: parsed.value };
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
        if (isUndefined(base.value)) return raw.value.trim() !== '';
        const parsed = parseRealValue(field, raw.value);
        return !isUndefined(parsed.error) || parsed.value !== base.value;
      },
      focus() {
        input.focus();
      },
      revert() {
        raw.value = isNullish(base.value) ? '' : String(base.value as number);
        local.value = '';
        routed.value = '';
      },
      rebase(value) {
        base.value = value;
        routed.value = '';
      },
    };
  },
  filter: {
    operators: () => ['eq', 'ne', 'lt', 'lte', 'gt', 'gte'],
    seed: () => 0,
    input({ value, set, commit, inputID }) {
      const bridged: Ref<number> = {
        get value() {
          return Number(value());
        },
        set value(next) {
          set(next);
        },
      };
      return numberInput(bridged, {
        id: inputID,
        name: inputID,
        decimalPlaces: Infinity,
        showSteppers: true,
        onCommit: (next) => commit(next),
      });
    },
  },
};

registerFieldType('number', numberType);

import type { Ref } from '../../../utils/reactive/ref.ts';
import type { NumberFieldOptions } from '../known-field-types.ts';

import { numericInputMode } from '../../../utils/html/numeric-input-mode.ts';
import { isNullish } from '../../../utils/is/is-nullish.ts';
import { isNumber } from '../../../utils/is/is-number.ts';
import { isUndefined } from '../../../utils/is/is-undefined.ts';
import { clamp } from '../../../utils/number/clamp.ts';
import { countDecimals } from '../../../utils/number/count-decimals.ts';
import { roundTo } from '../../../utils/number/round-to.ts';
import { ref } from '../../../utils/reactive/ref.ts';
import { checkRange } from '../../../utils/validate/check-range.ts';
import { h } from '../../render/h.ts';
import { useT } from '../../runtime/use-t.ts';
import { numberInput } from '../../ui/number-input.ts';
import { textInput } from '../../ui/text-input.ts';
import { checkedReading } from '../_checked-reading.ts';
import { cellEditor } from '../cell-editor.ts';
import { describeControl, fieldPlaceholder } from '../field-row.ts';
import { dimMark, type FieldType, registerFieldType } from '../field-type.ts';
import { parseRealValue } from '../parse.ts';

/**
 * The `number` field type: cell display, inline cell editor, form control, and filter.
 * The editor and control parse entry strictly to a finite double.
 * An emptied editor or control writes `null` on a nullable field; a non-nullable one omits.
 * The control validates on blur and on read; a changed value is checked against `min` and `max` too.
 * The arrow keys step it by 1, by 10 with Shift, kept to the value's own decimal places.
 * They stop at `min` and `max`.
 */
export const numberType: FieldType<NumberFieldOptions> = {
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

    const control = textInput(raw, { disabled: () => off, placeholder: fieldPlaceholder(field) });
    const input = control.querySelector('input') as HTMLInputElement;
    control.classList.add('ohne-input-numeric');
    const inputMode = numericInputMode(field.options?.min, true);
    if (inputMode) input.setAttribute('inputmode', inputMode);
    input.addEventListener('input', touch);
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      const parsed = parseRealValue(field, raw.value);
      if (!isNumber(parsed.value)) return;
      event.preventDefault();
      const step = (event.shiftKey ? 10 : 1) * (event.key === 'ArrowUp' ? 1 : -1);
      const stepped = roundTo(parsed.value + step, countDecimals(parsed.value));
      raw.value = String(
        clamp(stepped, field.options?.min ?? -Infinity, field.options?.max ?? Infinity),
      );
      touch();
    });
    input.addEventListener('blur', () => {
      const parsed = parseRealValue(field, raw.value);
      local.value = isUndefined(parsed.error) ? '' : t(parsed.error);
    });
    describeControl(input, field, path, error);

    const dirty = (): boolean => {
      if (isUndefined(base.value)) return raw.value.trim() !== '';
      const parsed = parseRealValue(field, raw.value);
      return !isUndefined(parsed.error) || parsed.value !== base.value;
    };
    const show = (value: unknown): void => {
      raw.value = isNullish(value) ? '' : String(value as string | number);
      local.value = '';
      routed.value = '';
    };

    return {
      element: control,
      read() {
        if (isUndefined(base.value) && raw.value.trim() === '') return {};
        const parsed = parseRealValue(field, raw.value);
        if (!isUndefined(parsed.error)) return { errors: { '': t(parsed.error) } };
        if (isUndefined(parsed.value)) return {};
        return checkedReading(
          parsed.value,
          isNumber(parsed.value) && dirty()
            ? checkRange(parsed.value, field.options ?? {})
            : undefined,
        );
      },
      draft() {
        if (isUndefined(base.value) && raw.value.trim() === '') return undefined;
        const parsed = parseRealValue(field, raw.value);
        return isUndefined(parsed.error) ? parsed.value : raw.value;
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
        input.focus();
      },
      revert() {
        show(base.value);
      },
      rebase(value) {
        base.value = value;
        routed.value = '';
      },
      restore: show,
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

import { isInteger } from '../../../utils/is/is-integer.ts';
import { isNullish } from '../../../utils/is/is-nullish.ts';
import { isUndefined } from '../../../utils/is/is-undefined.ts';
import { ref } from '../../../utils/reactive/ref.ts';
import { css } from '../../render/css.ts';
import { useT } from '../../runtime/use-t.ts';
import { textInput } from '../../ui/text-input.ts';
import { cellEditor } from '../cell-editor.ts';
import { describeControl } from '../field-row.ts';
import { dimMark, type FieldType, registerFieldType } from '../field-type.ts';
import { parseIntegerValue } from '../parse.ts';

css`
  .ohne-input.ohne-number {
    max-width: 180px;
    font-variant-numeric: tabular-nums;
  }
`;

/**
 * The `integer` field type: cell display, inline cell editor, and form control.
 * Everywhere the entry parses strictly: decimal digits only, no floats, no exponents.
 * An emptied editor or control writes `null` on a nullable field; a non-nullable one omits.
 * The control validates on blur and on read, and steps by 1 on the arrow keys, by 10 with Shift.
 */
export const integerType: FieldType = {
  display({ value }) {
    return () => {
      const current = value();
      return isNullish(current) ? dimMark('·') : String(current as number);
    };
  },
  editor({ field, value, commit, cancel }) {
    const current = value();
    return cellEditor({
      initial: isNullish(current) ? '' : String(current as number),
      commit(text) {
        const parsed = parseIntegerValue(field, text);
        if (!isUndefined(parsed.error) || isUndefined(parsed.value)) return false;
        return commit(parsed.value);
      },
      cancel,
    });
  },
  control({ field, initial, path, onInput }) {
    const t = useT();
    let base = initial;
    const raw = ref(isNullish(base) ? '' : String(base as number));
    const local = ref('');
    const routed = ref('');

    const error = (): string => (routed.value !== '' ? routed.value : local.value);
    const touch = (): void => {
      local.value = '';
      routed.value = '';
      onInput();
    };

    const control = textInput(raw);
    const input = control.querySelector('input') as HTMLInputElement;
    control.classList.add('ohne-number');
    input.setAttribute('inputmode', 'numeric');
    input.addEventListener('input', touch);
    input.addEventListener('blur', () => {
      const parsed = parseIntegerValue(field, raw.value);
      local.value = isUndefined(parsed.error) ? '' : t(parsed.error);
    });
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      const parsed = parseIntegerValue(field, raw.value);
      if (!isInteger(parsed.value)) return;
      event.preventDefault();
      const step = (event.shiftKey ? 10 : 1) * (event.key === 'ArrowUp' ? 1 : -1);
      raw.value = String(parsed.value + step);
      touch();
    });
    describeControl(input, field, path, error);

    return {
      element: control,
      read() {
        if (isUndefined(base) && raw.value.trim() === '') return {};
        const parsed = parseIntegerValue(field, raw.value);
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
        if (isUndefined(base)) return raw.value.trim() !== '';
        const parsed = parseIntegerValue(field, raw.value);
        return !isUndefined(parsed.error) || parsed.value !== base;
      },
      focus() {
        input.focus();
      },
      revert() {
        raw.value = isNullish(base) ? '' : String(base as number);
        local.value = '';
        routed.value = '';
      },
      rebase(value) {
        base = value;
        routed.value = '';
      },
    };
  },
};

registerFieldType('integer', integerType);

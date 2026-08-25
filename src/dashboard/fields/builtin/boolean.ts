import { isNullish } from '../../../utils/is/is-nullish.ts';
import { isUndefined } from '../../../utils/is/is-undefined.ts';
import { ref } from '../../../utils/reactive/ref.ts';
import { css } from '../../render/css.ts';
import { h } from '../../render/h.ts';
import { checkbox } from '../../ui/checkbox.ts';
import { describeControl } from '../field-row.ts';
import { dimMark, type FieldType, registerFieldType } from '../field-type.ts';

css`
  .cell-faint {
    color: var(--faint);
  }
`;

/**
 * The `boolean` field type: cell display, inline cell editor, and form control.
 * The cell shows a check for `true`, a faint cross for `false`, and a dim dot for `null`.
 * The cell editor toggles the value at once; a failed toggle closes back to the stored value.
 * The control is a checkbox that stays pristine until touched; once touched it reads binary.
 * A stored `null` therefore returns to `null` only through the row's revert.
 */
export const booleanType: FieldType = {
  display({ value }) {
    return () => {
      const current = value();
      if (isNullish(current)) return dimMark('·');
      return current === true ? '✓' : h('span', { class: 'cell-faint' }, '✕');
    };
  },
  editor({ value, commit, cancel }) {
    void commit(value() !== true).then((landing) => {
      if (!landing.landed) cancel();
    });
    return null;
  },
  control({ field, initial, path, onInput }) {
    let base = initial;
    const checked = ref(base === true);
    const touched = ref(false);
    const routed = ref('');

    const error = (): string => routed.value;
    const element = checkbox(checked);
    const input = element.querySelector('input') as HTMLInputElement;
    input.addEventListener('change', () => {
      touched.value = true;
      routed.value = '';
      onInput();
    });
    describeControl(input, field, path, error);

    // Untouched, the value is whatever is stored, so a stored null saves as null; once touched
    // the box reads binary, and only the row's revert leads back to null.
    const wire = (): unknown => {
      if (touched.value) return checked.value;
      return isNullish(base) ? (field.nullable ? null : false) : base === true;
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
        input.focus();
      },
      revert() {
        checked.value = base === true;
        touched.value = false;
        routed.value = '';
      },
      rebase(value) {
        base = value;
        checked.value = value === true;
        touched.value = false;
        routed.value = '';
      },
    };
  },
};

registerFieldType('boolean', booleanType);

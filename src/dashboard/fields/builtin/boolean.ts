import { isNullish } from '../../../utils/is/is-nullish.ts';
import { isUndefined } from '../../../utils/is/is-undefined.ts';
import { ref } from '../../../utils/reactive/ref.ts';
import { useT } from '../../runtime/use-t.ts';
import { badge } from '../../ui/badge.ts';
import { checkbox } from '../../ui/checkbox.ts';
import { describeControl } from '../field-row.ts';
import { dimMark, type FieldType, registerFieldType } from '../field-type.ts';

/**
 * The `boolean` field type: cell display, inline cell editor, and form control.
 * The cell shows a secondary badge reading yes or no, and a dim hyphen for `null`.
 * The `false` badge inherits the cell's muted color, so only a `true` reads as foreground.
 * The cell editor toggles the value at once; a failed toggle closes back to the stored value.
 * The control is a checkbox that stays pristine until touched; once touched it reads binary.
 * A stored `null` therefore returns to `null` only through the row's revert.
 */
export const booleanType: FieldType = {
  display({ value }) {
    const t = useT();
    return () => {
      const current = value();
      if (isNullish(current)) return dimMark('-');
      const yes = current === true;
      return badge(() => (yes ? t('dashboard.yes') : t('dashboard.no')), {
        color: 'secondary',
        textColor: yes ? undefined : 'inherit',
      });
    };
  },
  editor({ value, commit, cancel }) {
    void commit(value() !== true).then((landing) => {
      if (!landing.landed) cancel();
    });
    return null;
  },
  control({ field, initial, path, disabled, onInput }) {
    let base = initial;
    const checked = ref(base === true);
    const touched = ref(false);
    const routed = ref('');

    const error = (): string => routed.value;
    const element = checkbox(checked, undefined, { disabled: () => disabled === true });
    const input = element.querySelector('input') as HTMLInputElement;
    // The native input is the hidden proxy; the visible `role="checkbox"` button carries focus
    // and the aria wiring, or both would land on a `display: none` element and do nothing.
    const proxy = element.querySelector('button') as HTMLElement;
    input.addEventListener('change', () => {
      touched.value = true;
      routed.value = '';
      onInput();
    });
    describeControl(proxy, field, path, error);

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
        proxy.focus();
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

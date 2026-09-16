import type { Ref } from '../../../utils/reactive/ref.ts';
import type { Primitive } from '../../ui/button-group.ts';

import { isNullish } from '../../../utils/is/is-nullish.ts';
import { isUndefined } from '../../../utils/is/is-undefined.ts';
import { ref } from '../../../utils/reactive/ref.ts';
import { translateMessage, useT } from '../../runtime/use-t.ts';
import { badge } from '../../ui/badge.ts';
import { buttonGroup } from '../../ui/button-group.ts';
import { checkbox } from '../../ui/checkbox.ts';
import { switchInput } from '../../ui/switch.ts';
import { describeControl } from '../field-row.ts';
import { dimMark, type FieldType, registerFieldType } from '../field-type.ts';

/**
 * The `boolean` field type: cell display, inline cell editor, form control, and filter.
 * The cell shows a secondary badge reading yes or no, and a dim hyphen for `null`.
 * The `false` badge inherits the cell's muted color, so only a `true` reads as foreground.
 * The cell editor toggles the value at once; a failed toggle closes back to the stored value.
 * The control is a checkbox, a switch under `display: 'switch'`, or a two-choice group under `'buttons'`.
 * The group's choices read `falseLabel` and `trueLabel`, falling back to the catalog's no and yes.
 * It stays pristine until touched; once touched it reads binary.
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
    const t = useT();
    let base = initial;
    const checked = ref(base === true);
    const touched = ref(false);
    const routed = ref('');

    const error = (): string => routed.value;
    const touch = (): void => {
      touched.value = true;
      routed.value = '';
      onInput();
    };
    const display = field.options?.display;
    let element: HTMLElement;
    let proxy: HTMLElement;
    if (display === 'buttons') {
      const model: Ref<Primitive> = {
        get value() {
          return checked.value;
        },
        set value(next) {
          checked.value = next === true;
          touch();
        },
      };
      element = buttonGroup(model, {
        choices: () => [
          { value: false, label: translateMessage(field.options?.falseLabel) ?? t('dashboard.no') },
          { value: true, label: translateMessage(field.options?.trueLabel) ?? t('dashboard.yes') },
        ],
        variant: 'accent',
        disabled: () => disabled === true,
      });
      proxy = element;
    } else {
      const control = display === 'switch' ? switchInput : checkbox;
      element = control(checked, undefined, { disabled: () => disabled === true });
      const input = element.querySelector('input') as HTMLInputElement;
      // The native input is `display: none`, so focus and the aria wiring go on the visible button.
      proxy = element.querySelector('button') as HTMLElement;
      input.addEventListener('change', touch);
    }
    describeControl(proxy, field, path, error);

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
  filter: {
    operators: () => ['eq', 'ne'],
    seed: () => false,
    input({ value, commit, inputID }) {
      const t = useT();
      const bridged: Ref<Primitive> = {
        get value() {
          return value() === true;
        },
        set value(next) {
          commit(next === true);
        },
      };
      return buttonGroup(bridged, {
        choices: () => [
          { value: false, label: t('dashboard.filter.false') },
          { value: true, label: t('dashboard.filter.true') },
        ],
        variant: 'accent',
        id: inputID,
        name: inputID,
      });
    },
  },
};

registerFieldType('boolean', booleanType);

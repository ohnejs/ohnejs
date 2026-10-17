import type { IconName } from '../../../utils/icon/icon-name.ts';
import type { Ref } from '../../../utils/reactive/ref.ts';
import type { ValidationFailure } from '../../../utils/validate/validation-failure.ts';

import { isNull } from '../../../utils/is/is-null.ts';
import { isNullish } from '../../../utils/is/is-nullish.ts';
import { isString } from '../../../utils/is/is-string.ts';
import { isUndefined } from '../../../utils/is/is-undefined.ts';
import { ref } from '../../../utils/reactive/ref.ts';
import { h } from '../../render/h.ts';
import { useT } from '../../runtime/use-t.ts';
import { button } from '../../ui/button.ts';
import { textInput } from '../../ui/text-input.ts';
import { checkedReading } from '../_checked-reading.ts';
import { cellEditor } from '../cell-editor.ts';
import { describeControl, fieldPlaceholder } from '../field-row.ts';
import { dimMark, type FieldType } from '../field-type.ts';
import { parseTextValue } from '../parse.ts';

/**
 * What sets one address type apart: how its text is read, stored, checked and opened.
 */
export interface AddressSpec {
  /**
   * The keyboard a touch device shows for the input.
   */
  inputMode: 'email' | 'url';

  /**
   * The stored form of `text`, as the server's sanitizer writes it.
   */
  canonical(text: string): string;

  /**
   * The server's rule for a stored value.
   */
  check(value: string): ValidationFailure | undefined;

  /**
   * Where the control's button leads for `value`, or `undefined` to disable the button.
   */
  href(value: string): string | undefined;

  /**
   * The address someone meant by `text`, applied before `canonical`.
   * Omitted reads the text as typed.
   */
  typed?(text: string): string;

  /**
   * The icon of the control's button.
   */
  icon: IconName;

  /**
   * The label of the control's button.
   */
  action(): string;
}

/**
 * The field type of a text address such as an email or a web address.
 * The cell is plain text, so a row click still opens the record.
 * The editor and control write the canonical form and check it with the server's rule.
 * The control drafts the text as typed, so an undo step gives back the case and the scheme as entered.
 * A button beside the input opens the address, disabled while the address is invalid.
 * The filter keeps the text as typed but holds the canonical form, so a typed case variant still matches.
 */
export function addressType(spec: AddressSpec): FieldType<Record<never, never>> {
  const parse = (text: string): string => spec.canonical(spec.typed?.(text) ?? text);

  return {
    display({ value }) {
      return () => {
        const current = value();
        if (isNullish(current)) return dimMark('-');
        const text = String(current as string);
        return h('span', { class: 'ohne-truncate', title: text }, text);
      };
    },
    editor({ field, value, commit, cancel }) {
      const current = value();
      return cellEditor({
        initial: isNullish(current) ? '' : String(current as string),
        commit(text) {
          if (text.trim() === '' && field.nullable) return commit(null);
          const parsed = parse(text);
          return isUndefined(spec.check(parsed)) ? commit(parsed) : false;
        },
        cancel,
      });
    },
    control({ field, initial, path, disabled, onInput }) {
      const base = ref(initial);
      const raw = ref(isNullish(initial) ? '' : String(initial as string));
      const routed = ref('');

      const error = (): string => routed.value;
      const model: Ref<string> = {
        get value() {
          return raw.value;
        },
        set value(next) {
          raw.value = next;
          routed.value = '';
          onInput();
        },
      };
      const input = textInput(model, {
        disabled: () => disabled === true,
        placeholder: fieldPlaceholder(field),
      });
      const href = (): string | undefined => spec.href(parse(raw.value));
      const element = h(
        'div',
        { class: 'ohne-row' },
        input,
        button(spec.action, {
          icon: spec.icon,
          iconOnly: true,
          variant: 'outline',
          href: () => href() ?? '',
          disabled: () => isUndefined(href()),
          target: '_blank',
        }),
      );
      const control = input.querySelector('input') as HTMLInputElement;
      control.setAttribute('inputmode', spec.inputMode);
      control.setAttribute('autocapitalize', 'off');
      describeControl(control, field, path, error);

      const blank = (): boolean => raw.value.trim() === '';
      const pristine = (): boolean => isUndefined(base.value) && blank();
      const wire = (): unknown => (blank() ? parseTextValue(field, '') : parse(raw.value));
      const dirty = (): boolean => {
        if (isUndefined(base.value)) return !blank();
        return wire() !== (isNull(base.value) ? null : parse(String(base.value as string)));
      };
      const show = (value: unknown): void => {
        raw.value = isNullish(value) ? '' : String(value as string);
        routed.value = '';
      };

      return {
        element,
        read() {
          if (pristine()) return {};
          const value = wire();
          return checkedReading(value, isString(value) && dirty() ? spec.check(value) : undefined);
        },
        draft() {
          if (pristine()) return undefined;
          return blank() ? parseTextValue(field, '') : raw.value;
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
          control.focus();
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
      operators: () => ['eq', 'ne', 'startsWith', 'endsWith', 'contains', 'notContains'],
      seed: () => '',
      input({ value, set, commit, inputID }) {
        const t = useT();
        let typed = String(value());
        const text: Ref<string> = {
          get value() {
            const current = String(value());
            return spec.canonical(typed) === current ? typed : current;
          },
          set value(next) {
            typed = next;
            set(spec.canonical(next));
          },
        };
        return textInput(text, {
          id: inputID,
          name: inputID,
          placeholder: () => t('dashboard.filter.empty'),
          onBlur: () => commit(),
        });
      },
    },
  };
}

import type { Ref } from '../../../utils/reactive/ref.ts';

import { isNull } from '../../../utils/is/is-null.ts';
import { isNullish } from '../../../utils/is/is-nullish.ts';
import { isUndefined } from '../../../utils/is/is-undefined.ts';
import { ref } from '../../../utils/reactive/ref.ts';
import { h } from '../../render/h.ts';
import { when } from '../../render/when.ts';
import { useT } from '../../runtime/use-t.ts';
import { textArea } from '../../ui/text-area.ts';
import { textInput } from '../../ui/text-input.ts';
import { cellEditor } from '../cell-editor.ts';
import { describeControl } from '../field-row.ts';
import { dimMark, type FieldType, registerFieldType } from '../field-type.ts';
import { parseTextValue } from '../parse.ts';

/**
 * The `text` field type: cell display, inline cell editor, form control, and filter.
 * The cell carries the full string in its title; the empty string shows as a faint mono `""`.
 * An emptied editor or control writes `null` on a nullable field, the empty string otherwise.
 * The control starts single-line, or as a textarea when the field declares `multiline`.
 * Shift+Enter or a stored newline upgrades it to an auto-growing textarea; once multiline it stays.
 */
export const textType: FieldType = {
  display({ value }) {
    return () => {
      const current = value();
      if (isNullish(current)) return dimMark('-');
      const text = String(current as string);
      if (text === '') return h('span', { class: 'cell-faint cell-mono' }, '""');
      return h('span', { class: 'ohne-truncate', title: text }, text);
    };
  },
  editor({ field, value, commit, cancel }) {
    const current = value();
    return cellEditor({
      initial: isNullish(current) ? '' : String(current as string),
      commit: (text) => commit(text === '' && field.nullable ? null : text),
      cancel,
    });
  },
  control({ field, initial, path, disabled, onInput }) {
    const off = disabled === true;
    const base = ref(initial);
    const seed = isNullish(initial) ? '' : String(initial as string);
    const raw = ref(seed);
    const multiline = ref(field.options?.multiline === true || seed.includes('\n'));
    const routed = ref('');
    let element: HTMLInputElement | HTMLTextAreaElement | undefined;
    let caret = -1;

    const error = (): string => routed.value;
    const touch = (): void => {
      routed.value = '';
      onInput();
    };

    const singleLine = (): HTMLElement => {
      const control = textInput(raw, { disabled: () => off, placeholder: field.placeholder });
      const input = control.querySelector('input') as HTMLInputElement;
      input.addEventListener('input', touch);
      input.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' || !event.shiftKey) return;
        event.preventDefault();
        const start = input.selectionStart ?? raw.value.length;
        const end = input.selectionEnd ?? start;
        raw.value = `${raw.value.slice(0, start)}\n${raw.value.slice(end)}`;
        caret = start + 1;
        multiline.value = true;
        touch();
      });
      describeControl(input, field, path, error);
      element = input;
      return control;
    };

    const multiLine = (): HTMLElement => {
      const control = textArea(raw, { disabled: () => off, placeholder: field.placeholder });
      const area = control.querySelector('textarea') as HTMLTextAreaElement;
      area.addEventListener('input', touch);
      describeControl(area, field, path, error);
      element = area;
      if (caret >= 0) {
        const at = caret;
        caret = -1;
        queueMicrotask(() => {
          area.focus();
          area.setSelectionRange(at, at);
        });
      }
      return control;
    };

    const wire = (): unknown => {
      if (raw.value !== '') return raw.value;
      return base.value === '' ? '' : parseTextValue(field, '');
    };

    return {
      element: h(
        'div',
        null,
        when(() => multiline.value, multiLine, singleLine),
      ),
      read() {
        if (isUndefined(base.value) && raw.value === '') return {};
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
        if (isUndefined(base.value)) return raw.value !== '';
        return wire() !== (isNull(base.value) ? null : String(base.value as string));
      },
      focus() {
        element?.focus();
      },
      revert() {
        raw.value = isNullish(base.value) ? '' : String(base.value as string);
        routed.value = '';
      },
      rebase(value) {
        base.value = value;
        routed.value = '';
      },
    };
  },
  filter: {
    operators: () => ['eq', 'ne', 'startsWith', 'endsWith', 'contains', 'notContains'],
    seed: () => '',
    input({ value, set, commit, inputID }) {
      const t = useT();
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

registerFieldType('text', textType);

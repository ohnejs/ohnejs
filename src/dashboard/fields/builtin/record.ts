import type { DashboardField } from '../../runtime/meta-types.ts';

import { isNull } from '../../../utils/is/is-null.ts';
import { isNullish } from '../../../utils/is/is-nullish.ts';
import { isString } from '../../../utils/is/is-string.ts';
import { isUndefined } from '../../../utils/is/is-undefined.ts';
import { type Ref, ref } from '../../../utils/reactive/ref.ts';
import { h } from '../../render/h.ts';
import { cellEditor } from '../cell-editor.ts';
import { describeControl } from '../field-row.ts';
import { controlIDs, dimMark, type FieldType, registerFieldType } from '../field-type.ts';
import { labelOf } from '../labels.ts';
import { recordSelect } from '../record-select.ts';

/**
 * The `record` field's dashboard behaviour.
 *
 * Cells display the target's resolved label, falling back to the short `UUID` while it loads.
 * The inline editor and the form control are both the search combobox.
 * When the target is unreadable or has no text field, a plain mono `UUID` editor stands in.
 */
export const recordType: FieldType = {
  display({ field, value }) {
    return () => {
      const current = value();
      if (isNullish(current)) return dimMark('·');
      const uuid = String(current as string);
      const target = field.target ?? '';
      const resolved = labelOf(target, uuid);
      if (isUndefined(resolved)) {
        return h('span', { class: 'cell-mono cell-dim', title: uuid }, uuid.slice(0, 8));
      }
      return h('span', { title: uuid }, resolved);
    };
  },
  editor(context) {
    const select = recordSelect({
      field: context.field,
      mode: 'cell',
      value: () => {
        const current = context.value();
        return isString(current) ? current : null;
      },
      onPick: (uuid) => void context.commit(uuid),
      onCancel: context.cancel,
    });
    if (!isUndefined(select)) return select;
    const current = context.value();
    return cellEditor({
      initial: isNullish(current) ? '' : String(current as string),
      mono: true,
      commit: (text) => context.commit(text === '' ? null : text),
      cancel: context.cancel,
    });
  },
  control(context) {
    let base = context.initial;
    const uuid = ref<string | null>(isString(base) ? base : null);
    const touched = ref(false);
    const routed = ref('');

    const baseUUID = (): string | null => (isString(base) ? base : null);

    const select = recordSelect({
      field: context.field,
      mode: 'form',
      value: () => uuid.value,
      inputId: controlIDs(context.path).input,
      onPick: (picked) => {
        uuid.value = picked;
        touched.value = true;
        routed.value = '';
        context.onInput();
      },
    });
    const fallback = isUndefined(select)
      ? fallbackInput(context, uuid, touched, routed)
      : undefined;
    const element = select ?? fallback?.element;

    return {
      element,
      read() {
        if (!touched.value && isUndefined(base)) return {};
        if (isNull(uuid.value) && !context.field.nullable) return {};
        return { value: uuid.value };
      },
      setErrors(errors) {
        routed.value = errors[''] ?? '';
        for (const [key, message] of Object.entries(errors)) {
          if (key !== '') return message;
        }
        return '';
      },
      error: () => routed.value,
      dirty: () => touched.value && uuid.value !== baseUUID(),
      focus() {
        if (!isUndefined(fallback)) {
          fallback.focus();
          return;
        }
        if (select instanceof HTMLElement) {
          select.querySelector<HTMLElement>('button, input')?.focus();
        }
      },
      revert() {
        uuid.value = baseUUID();
        touched.value = false;
        routed.value = '';
        fallback?.sync();
      },
      rebase(value) {
        base = value;
        uuid.value = baseUUID();
        touched.value = false;
        routed.value = '';
        fallback?.sync();
      },
    };
  },
};

/**
 * The mono `UUID` input standing in when the combobox cannot search the target.
 */
function fallbackInput(
  context: { field: DashboardField; path: string; onInput(): void },
  uuid: Ref<string | null>,
  touched: Ref<boolean>,
  routed: Ref<string>,
): { element: HTMLInputElement; focus(): void; sync(): void } {
  const input = h('input', {
    class: 'ohne-input mono',
    type: 'text',
    onInput: () => {
      uuid.value = input.value === '' ? null : input.value;
      touched.value = true;
      routed.value = '';
      context.onInput();
    },
  }) as HTMLInputElement;
  input.value = uuid.value ?? '';
  describeControl(input, context.field, context.path, () => routed.value);
  return {
    element: input,
    focus: () => input.focus(),
    sync() {
      input.value = uuid.value ?? '';
    },
  };
}

registerFieldType('record', recordType);

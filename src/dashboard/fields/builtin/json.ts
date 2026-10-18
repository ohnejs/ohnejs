import type { Ref } from '../../../utils/reactive/ref.ts';
import type { JSONFieldOptions } from '../known-field-types.ts';

import { isNullish } from '../../../utils/is/is-nullish.ts';
import { isUndefined } from '../../../utils/is/is-undefined.ts';
import { deepEqual } from '../../../utils/object/deep-equal.ts';
import { computed } from '../../../utils/reactive/computed.ts';
import { ref } from '../../../utils/reactive/ref.ts';
import { checkJSON } from '../../../utils/validate/check-json.ts';
import { h } from '../../render/h.ts';
import { useT } from '../../runtime/use-t.ts';
import { codeEditor } from '../../ui/code-editor.ts';
import { checkedReading } from '../_checked-reading.ts';
import { describeControl, fieldPlaceholder } from '../field-row.ts';
import { dimMark, type FieldType, registerFieldType } from '../field-type.ts';
import { parseJSONValue } from '../parse.ts';

/**
 * The `json` field type: cell display and form control.
 * The cell shows the value as compact mono JSON, with the full text as its title.
 * The control is a `codeEditor` highlighting JSON, seeded with the value pretty-printed.
 * A changed value is checked against `maxDepth`; text that does not parse blocks the write.
 * An edit that only moves keys or whitespace leaves the value as it was, so it reads clean.
 * An emptied control writes `null` on a nullable field; a non-nullable one omits.
 */
export const jsonType: FieldType<JSONFieldOptions> = {
  display({ value }) {
    return () => {
      const current = value();
      if (isNullish(current)) return dimMark('-');
      const text = JSON.stringify(current);
      return h('span', { class: 'ohne-truncate cell-mono', title: text }, text);
    };
  },
  control({ field, initial, path, disabled, onInput }) {
    const t = useT();
    const base = ref(initial);
    const raw = ref(pretty(initial));
    const routed = ref('');
    const parsed = computed(() => parseJSONValue(field, raw.value));
    let good = initial;

    const error = (): string => routed.value;
    const model: Ref<string> = {
      get value() {
        return raw.value;
      },
      set value(next) {
        raw.value = next;
        routed.value = '';
        if (isUndefined(parsed.value.error)) good = parsed.value.value;
        onInput();
      },
    };
    const element = codeEditor(model, {
      language: 'json',
      placeholder: fieldPlaceholder(field),
      disabled: () => disabled === true,
    });
    const area = element.querySelector('textarea') as HTMLTextAreaElement;
    describeControl(area, field, path, error);

    const pristine = (): boolean => isUndefined(base.value) && raw.value.trim() === '';
    const dirty = (): boolean => {
      if (isUndefined(base.value)) return raw.value.trim() !== '';
      const { value, error: failure } = parsed.value;
      return !isUndefined(failure) || !deepEqual(value, base.value);
    };
    // A value equal to the baseline answers as the baseline, so moved keys never read as an edit.
    const settled = (): unknown => (deepEqual(good, base.value) ? base.value : good);
    const show = (value: unknown): void => {
      raw.value = pretty(value);
      routed.value = '';
      good = value;
    };

    return {
      element,
      read() {
        if (pristine()) return {};
        const { value, error: failure } = parsed.value;
        if (!isUndefined(failure)) return { errors: { '': t(failure) } };
        if (isUndefined(value)) return {};
        return checkedReading(
          settled(),
          dirty() ? checkJSON(value, { maxDepth: field.options?.maxDepth }) : undefined,
        );
      },
      draft() {
        return pristine() ? undefined : settled();
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
        area.focus();
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
};

/**
 * A value as the control seeds it: pretty-printed JSON two spaces deep, or nothing when absent.
 */
function pretty(value: unknown): string {
  return isNullish(value) ? '' : JSON.stringify(value, null, 2);
}

registerFieldType('json', jsonType);

import type { Ref } from '../../../utils/reactive/ref.ts';
import type { ColorFieldOptions } from '../known-field-types.ts';

import { isNull } from '../../../utils/is/is-null.ts';
import { isNullish } from '../../../utils/is/is-nullish.ts';
import { isString } from '../../../utils/is/is-string.ts';
import { isUndefined } from '../../../utils/is/is-undefined.ts';
import { ref } from '../../../utils/reactive/ref.ts';
import { checkColor } from '../../../utils/validate/check-color.ts';
import { css } from '../../render/css.ts';
import { h } from '../../render/h.ts';
import { useT } from '../../runtime/use-t.ts';
import { canonicalColor, colorChip, colorInput } from '../../ui/color-input.ts';
import { textInput } from '../../ui/text-input.ts';
import { checkedReading } from '../_checked-reading.ts';
import { describeControl, fieldPlaceholder } from '../field-row.ts';
import { controlIDs, dimMark, type FieldType, registerFieldType } from '../field-type.ts';
import { parseTextValue } from '../parse.ts';

css`
  .ohne-color-cell {
    display: inline-flex;
    align-items: center;
    gap: 0.5em;
  }
`;

/**
 * The `color` field type: cell display, form control, and filter.
 * The cell shows a chip of the color beside its hex; a value that is no hex color shows as dim text.
 * The control is a `colorInput`, with an opacity input under `alpha` and a swatch row under `swatches`.
 * Each swatch is a labelled control of the field like the hex input, named by the field label and its hex.
 * The control writes the stored form, so `#F80` saves as `#ff8800`, and checks it with the server's rule.
 * The filter keeps the text as typed but holds the stored form, so a typed `#F80` matches `#ff8800`.
 */
export const colorType: FieldType<ColorFieldOptions> = {
  display({ value }) {
    return () => {
      const current = value();
      if (isNullish(current)) return dimMark('-');
      const hex = canonicalColor(current);
      if (isUndefined(hex)) return dimMark(String(current as string));
      return h(
        'span',
        { class: 'ohne-color-cell', title: hex },
        colorChip(() => hex),
        h('span', { class: 'cell-mono' }, hex),
      );
    };
  },
  control({ field, initial, path, disabled, onInput }) {
    const t = useT();
    const alpha = field.options?.alpha === true;
    const base = ref(initial);
    const raw = ref(isNullish(initial) ? '' : String(initial as string));
    const routed = ref('');

    const error = (): string => routed.value;
    // A swatch click lands as its own step; the hex, the opacity, and the picker write as typing does.
    let picked = false;
    const model: Ref<string> = {
      get value() {
        return raw.value;
      },
      set value(next) {
        raw.value = next;
        routed.value = '';
        onInput(picked);
        picked = false;
      },
    };
    const element = colorInput(model, {
      alpha,
      swatches: field.options?.swatches,
      disabled: () => disabled === true,
      placeholder: fieldPlaceholder(field),
      labels: {
        pick: () => t('dashboard.color.pick'),
        opacity: () => t('dashboard.color.opacity'),
      },
    });
    element.addEventListener(
      'click',
      ({ target }) => {
        picked = target instanceof Element && !isNull(target.closest('.ohne-color-swatch'));
      },
      true,
    );
    const control = element.querySelector('input.ohne-input-control') as HTMLInputElement;
    describeControl(control, field, path, error);
    // Labelled as the field's own control, like its input, so a history step keeps focus on a pressed swatch.
    const ids = controlIDs(path);
    element.querySelectorAll<HTMLElement>('.ohne-color-swatch').forEach((swatch, index) => {
      swatch.id = `${ids.input}-swatch-${index}`;
      swatch.setAttribute('aria-labelledby', `${ids.label} ${swatch.id}`);
    });

    const wire = (): unknown =>
      raw.value === '' ? parseTextValue(field, '') : (canonicalColor(raw.value) ?? raw.value);
    const dirty = (): boolean => {
      if (isUndefined(base.value)) return raw.value !== '';
      return wire() !== (isNull(base.value) ? null : (canonicalColor(base.value) ?? base.value));
    };
    const show = (value: unknown): void => {
      raw.value = isNullish(value) ? '' : String(value as string);
      routed.value = '';
    };

    return {
      element,
      read() {
        if (isUndefined(base.value) && raw.value === '') return {};
        const value = wire();
        return checkedReading(
          value,
          isString(value) && dirty() ? checkColor(value, { alpha }) : undefined,
        );
      },
      draft() {
        if (isUndefined(base.value) && raw.value === '') return undefined;
        return raw.value === '' ? parseTextValue(field, '') : raw.value;
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
    operators: () => ['eq', 'ne'],
    seed: () => '',
    input({ value, set, commit, inputID }) {
      const t = useT();
      let typed = String(value());
      const text: Ref<string> = {
        get value() {
          const current = String(value());
          return (canonicalColor(typed) ?? typed) === current ? typed : current;
        },
        set value(next) {
          typed = next;
          set(canonicalColor(next) ?? next);
        },
      };
      return textInput(text, {
        id: inputID,
        name: inputID,
        spellcheck: false,
        placeholder: () => t('dashboard.filter.empty'),
        onBlur: () => commit(),
      });
    },
  },
};

registerFieldType('color', colorType);

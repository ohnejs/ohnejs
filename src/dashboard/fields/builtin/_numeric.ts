import type { Ref } from '../../../utils/reactive/ref.ts';
import type { DashboardField } from '../../runtime/meta-types.ts';
import type { NumberFieldOptions } from '../known-field-types.ts';
import type { ScalarParse } from '../parse.ts';

import { numericInputMode } from '../../../utils/html/numeric-input-mode.ts';
import { isNullish } from '../../../utils/is/is-nullish.ts';
import { isNumber } from '../../../utils/is/is-number.ts';
import { isUndefined } from '../../../utils/is/is-undefined.ts';
import { clamp } from '../../../utils/number/clamp.ts';
import { countDecimals } from '../../../utils/number/count-decimals.ts';
import { roundTo } from '../../../utils/number/round-to.ts';
import { stepValue } from '../../../utils/number/step-value.ts';
import { ref } from '../../../utils/reactive/ref.ts';
import { checkRange } from '../../../utils/validate/check-range.ts';
import { checkStep } from '../../../utils/validate/check-step.ts';
import { css } from '../../render/css.ts';
import { h } from '../../render/h.ts';
import { translateMessage, useT } from '../../runtime/use-t.ts';
import { numberInput } from '../../ui/number-input.ts';
import { slider } from '../../ui/slider.ts';
import { textInput } from '../../ui/text-input.ts';
import { checkedReading } from '../_checked-reading.ts';
import { cellEditor } from '../cell-editor.ts';
import { describeControl, fieldPlaceholder } from '../field-row.ts';
import { dimMark, type FieldType } from '../field-type.ts';

/**
 * How one numeric field type reads its input.
 */
export interface NumericKind {
  /**
   * Parses typed text strictly into the field's numbers.
   */
  parse: (field: DashboardField, raw: string) => ScalarParse;

  /**
   * Whether the field holds fractions, so the input offers a decimal keypad and the filter keeps decimals.
   */
  decimal: boolean;
}

css`
  .ohne-numeric-cell {
    display: flex;
    align-items: baseline;
    gap: 0.25em;
    min-width: 0;
  }

  .ohne-numeric-cell > .cell-dim {
    flex: none;
  }

  .ohne-input > .ohne-numeric-suffix {
    margin-left: 0;
    color: hsl(var(--ohne-muted-foreground));
    font-size: calc(1em - 0.125rem);
    white-space: nowrap;
  }

  .ohne-numeric-slider {
    display: flex;
    align-items: center;
    gap: 1em;
  }

  .ohne-numeric-slider > .ohne-input {
    flex: none;
    width: 7.5em;
  }
`;

/**
 * The shared behaviour of `number` and `integer`: cell, summary, inline editor, form control, and filter.
 * The cell and summary carry the `suffix` unit; the control shows it inside the input.
 * The arrow keys move along the `step` grid, ten steps with Shift, and stop on the last point within bounds.
 * Without `step` they move by 1, kept to the value's own decimal places.
 * Under `display: 'slider'` a range track beside the input edits the same value, given `min` and `max`.
 * A changed value is checked against `min`, `max`, and `step`, with the server's messages.
 * An emptied editor or control writes `null` on a nullable field; a non-nullable one omits.
 */
export function numericFieldType(kind: NumericKind): FieldType<NumberFieldOptions> {
  const { parse, decimal } = kind;
  return {
    display({ field, value }) {
      return () => {
        const current = value();
        if (isNullish(current)) return dimMark('-');
        const text = String(current as number);
        const unit = translateMessage(field.options?.suffix);
        if (isUndefined(unit)) return h('span', { class: 'ohne-truncate', title: text }, text);
        return h(
          'span',
          { class: 'ohne-numeric-cell', title: `${text} ${unit}` },
          h('span', { class: 'ohne-truncate' }, text),
          dimMark(unit),
        );
      };
    },
    summary(value, field) {
      if (!isNumber(value)) return '';
      const unit = translateMessage(field.options?.suffix);
      return isUndefined(unit) ? String(value) : `${value} ${unit}`;
    },
    editor({ field, value, commit, cancel }) {
      const current = value();
      return cellEditor({
        initial: isNullish(current) ? '' : String(current as number),
        commit(text) {
          const parsed = parse(field, text);
          if (!isUndefined(parsed.error) || isUndefined(parsed.value)) return false;
          return commit(parsed.value);
        },
        cancel,
      });
    },
    control({ field, initial, path, disabled, onInput }) {
      const t = useT();
      const off = disabled === true;
      const { min, max, step, suffix, display } = field.options ?? {};
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

      const box = textInput(raw, {
        disabled: () => off,
        placeholder: fieldPlaceholder(field),
        suffix: isUndefined(suffix)
          ? undefined
          : h('span', { class: 'ohne-numeric-suffix' }, () => translateMessage(suffix)),
      });
      const input = box.querySelector('input') as HTMLInputElement;
      box.classList.add('ohne-input-numeric');
      const inputMode = numericInputMode(min, decimal);
      if (inputMode) input.setAttribute('inputmode', inputMode);
      input.addEventListener('input', touch);
      input.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        const parsed = parse(field, raw.value);
        if (!isNumber(parsed.value)) return;
        event.preventDefault();
        const count = (event.shiftKey ? 10 : 1) * (event.key === 'ArrowUp' ? 1 : -1);
        const moved = isUndefined(step)
          ? clamp(
              roundTo(parsed.value + count, countDecimals(parsed.value)),
              min ?? -Infinity,
              max ?? Infinity,
            )
          : stepValue(parsed.value, count, { step, min, max });
        raw.value = String(moved);
        touch();
      });
      input.addEventListener('blur', () => {
        const parsed = parse(field, raw.value);
        local.value = isUndefined(parsed.error) ? '' : t(parsed.error);
      });
      describeControl(input, field, path, error);

      const element =
        display === 'slider' && !isUndefined(min) && !isUndefined(max)
          ? h('div', { class: 'ohne-numeric-slider' }, numericSlider(), box)
          : box;

      /**
       * The range track beside the input, bridged to the same typed text.
       */
      function numericSlider(): HTMLElement {
        const bridged: Ref<number | undefined> = {
          get value() {
            const parsed = parse(field, raw.value).value;
            return isNumber(parsed) ? parsed : undefined;
          },
          set value(next) {
            raw.value = isUndefined(next) ? '' : String(next);
            touch();
          },
        };
        const track = slider(bridged, { min: min!, max: max!, step, disabled: () => off });
        const range = track.querySelector('input') as HTMLInputElement;
        range.tabIndex = -1;
        range.setAttribute('aria-hidden', 'true');
        return track;
      }

      const dirty = (): boolean => {
        if (isUndefined(base.value)) return raw.value.trim() !== '';
        const parsed = parse(field, raw.value);
        return !isUndefined(parsed.error) || parsed.value !== base.value;
      };
      const show = (value: unknown): void => {
        raw.value = isNullish(value) ? '' : String(value as string | number);
        local.value = '';
        routed.value = '';
      };

      return {
        element,
        read() {
          if (isUndefined(base.value) && raw.value.trim() === '') return {};
          const parsed = parse(field, raw.value);
          if (!isUndefined(parsed.error)) return { errors: { '': t(parsed.error) } };
          if (isUndefined(parsed.value)) return {};
          const grid = { min, max, step };
          return checkedReading(
            parsed.value,
            isNumber(parsed.value) && dirty()
              ? (checkRange(parsed.value, grid) ?? checkStep(parsed.value, grid))
              : undefined,
          );
        },
        draft() {
          if (isUndefined(base.value) && raw.value.trim() === '') return undefined;
          const parsed = parse(field, raw.value);
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
      input({ field, value, set, commit, inputID }) {
        const { step, suffix } = field.options ?? {};
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
          decimalPlaces: decimal ? Infinity : undefined,
          increment: step,
          suffix: isUndefined(suffix) ? undefined : () => translateMessage(suffix),
          showSteppers: true,
          onCommit: (next) => commit(next),
        });
      },
    },
  };
}

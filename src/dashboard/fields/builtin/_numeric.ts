import type { Ref } from '../../../utils/reactive/ref.ts';
import type { ValidationFailure } from '../../../utils/validate/validation-failure.ts';
import type { Child } from '../../render/insert.ts';
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
import { computed } from '../../../utils/reactive/computed.ts';
import { ref } from '../../../utils/reactive/ref.ts';
import { untracked } from '../../../utils/reactive/untracked.ts';
import { checkRange } from '../../../utils/validate/check-range.ts';
import { checkStep } from '../../../utils/validate/check-step.ts';
import { css } from '../../render/css.ts';
import { h } from '../../render/h.ts';
import { useDashboardLanguage } from '../../runtime/use-dashboard-language.ts';
import { translateMessage } from '../../runtime/use-t.ts';
import { numberInput } from '../../ui/number-input.ts';
import { slider } from '../../ui/slider.ts';
import { textInput } from '../../ui/text-input.ts';
import { checkedReading } from '../_checked-reading.ts';
import { cellEditor } from '../cell-editor.ts';
import { describeControl, fieldPlaceholder } from '../field-row.ts';
import { dimMark, type FieldFilterContext, type FieldType } from '../field-type.ts';

/**
 * How a numeric field writes, reads, and checks its values: the plain notation or a field's own.
 */
export interface NumericNotation {
  /**
   * Parses typed text into the stored number, or the message that refuses it.
   */
  parse(raw: string): ScalarParse;

  /**
   * The text a user edits for a stored value.
   */
  text(value: number): string;

  /**
   * The value as a cell or summary shows it, without the `unit`.
   */
  show(value: number): string;

  /**
   * The unit a cell and summary show after the value, if any.
   */
  unit(): string | undefined;

  /**
   * The symbol the input shows beside the text, and on which side, if any.
   */
  affix(): { side: 'prefix' | 'suffix'; symbol: string } | undefined;

  /**
   * Checks a changed value, with the server's messages.
   */
  check(value: number): ValidationFailure | undefined;

  /**
   * The value the arrow keys move to, `count` steps away.
   */
  move(value: number, count: number): number;

  /**
   * Whether the text takes a decimal mark, so a touch keyboard offers one.
   */
  decimal: boolean;

  /**
   * Whether a valid blur rewrites the text in its canonical form, like `12,3` as `12,30`.
   */
  canonical: boolean;
}

/**
 * How one numeric field type reads its input.
 */
export interface NumericKind<O extends NumberFieldOptions> {
  /**
   * Parses typed text strictly into the field's numbers.
   */
  parse: (field: DashboardField<O>, raw: string) => ScalarParse;

  /**
   * Whether the field holds fractions, so the input offers a decimal keypad and the filter keeps decimals.
   */
  decimal: boolean;

  /**
   * A field's own notation, like an amount in a currency; `undefined` keeps the plain one.
   */
  notation?: (field: DashboardField<O>, language: string) => NumericNotation | undefined;
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

  .ohne-input > .ohne-numeric-affix {
    color: hsl(var(--ohne-muted-foreground));
    font-size: calc(1em - 0.125rem);
    white-space: nowrap;
  }

  .ohne-input > .ohne-numeric-prefix {
    margin-right: 0;
  }

  .ohne-input > .ohne-numeric-suffix {
    margin-left: 0;
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
 * A kind's `notation` replaces all of that per field, as an amount in a currency does.
 * An emptied editor or control writes `null` on a nullable field; a non-nullable one omits.
 */
export function numericFieldType<O extends NumberFieldOptions>(kind: NumericKind<O>): FieldType<O> {
  const notationOf = (field: DashboardField<O>, language: string): NumericNotation =>
    kind.notation?.(field, language) ?? plainNotation(kind, field);
  return {
    display({ field, value, language }) {
      return () => {
        const current = value();
        if (isNullish(current)) return dimMark('-');
        const notation = notationOf(field, language());
        const text = notation.show(current as number);
        const unit = notation.unit();
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
      const notation = notationOf(field, useDashboardLanguage().value);
      const unit = notation.unit();
      return isUndefined(unit) ? notation.show(value) : `${notation.show(value)} ${unit}`;
    },
    editor({ field, value, language, commit, cancel }) {
      const current = value();
      const notation = notationOf(field, language());
      return cellEditor({
        initial: isNullish(current) ? '' : notation.text(current as number),
        commit(text) {
          const parsed = notation.parse(text);
          if (!isUndefined(parsed.error) || isUndefined(parsed.value)) return false;
          return commit(parsed.value);
        },
        cancel,
      });
    },
    control({ field, initial, path, disabled, language, onInput }) {
      const off = disabled === true;
      const { min, max, step, display } = field.options ?? {};
      const notation = computed(() => notationOf(field, language()));
      const base = ref(initial);
      const raw = ref(textOf(initial));
      const local = ref('');
      const routed = ref('');

      /**
       * The text a value edits as: a stored number in the field's notation, a drafted text as typed.
       */
      function textOf(value: unknown): string {
        if (isNullish(value)) return '';
        return isNumber(value) ? untracked(() => notation.value.text(value)) : String(value);
      }

      const error = (): string => (routed.value !== '' ? routed.value : local.value);
      const touch = (): void => {
        local.value = '';
        routed.value = '';
        onInput();
      };
      const affix = (side: 'prefix' | 'suffix') => (): Child => {
        const shown = notation.value.affix();
        return shown?.side === side
          ? h('span', { class: `ohne-numeric-affix ohne-numeric-${side}` }, shown.symbol)
          : null;
      };

      const box = textInput(raw, {
        disabled: () => off,
        placeholder: fieldPlaceholder(field),
        prefix: affix('prefix'),
        suffix: affix('suffix'),
      });
      const input = box.querySelector('input') as HTMLInputElement;
      box.classList.add('ohne-input-numeric');
      const inputMode = numericInputMode(
        min,
        untracked(() => notation.value.decimal),
      );
      if (inputMode) input.setAttribute('inputmode', inputMode);
      input.addEventListener('input', touch);
      input.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        const parsed = notation.value.parse(raw.value);
        if (!isNumber(parsed.value)) return;
        event.preventDefault();
        const count = (event.shiftKey ? 10 : 1) * (event.key === 'ArrowUp' ? 1 : -1);
        raw.value = notation.value.text(notation.value.move(parsed.value, count));
        touch();
      });
      input.addEventListener('blur', () => {
        const parsed = notation.value.parse(raw.value);
        local.value = isUndefined(parsed.error) ? '' : translateMessage(parsed.error);
        if (notation.value.canonical && isNumber(parsed.value)) {
          raw.value = notation.value.text(parsed.value);
        }
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
            const parsed = notation.value.parse(raw.value).value;
            return isNumber(parsed) ? parsed : undefined;
          },
          set value(next) {
            raw.value = isUndefined(next) ? '' : notation.value.text(next);
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
        const parsed = notation.value.parse(raw.value);
        return !isUndefined(parsed.error) || parsed.value !== base.value;
      };
      const show = (value: unknown): void => {
        raw.value = textOf(value);
        local.value = '';
        routed.value = '';
      };

      return {
        element,
        read() {
          if (isUndefined(base.value) && raw.value.trim() === '') return {};
          const parsed = notation.value.parse(raw.value);
          if (!isUndefined(parsed.error)) return { errors: { '': translateMessage(parsed.error) } };
          if (isUndefined(parsed.value)) return {};
          return checkedReading(
            parsed.value,
            isNumber(parsed.value) && dirty() ? notation.value.check(parsed.value) : undefined,
          );
        },
        draft() {
          if (isUndefined(base.value) && raw.value.trim() === '') return undefined;
          const parsed = notation.value.parse(raw.value);
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
      input(context) {
        const own = kind.notation?.(context.field, context.language());
        if (!isUndefined(own)) return notationFilter(own, context);
        const { field, value, set, commit, inputID } = context;
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
          decimalPlaces: kind.decimal ? Infinity : undefined,
          increment: step,
          suffix: isUndefined(suffix) ? undefined : () => translateMessage(suffix),
          showSteppers: true,
          onCommit: (next) => commit(next),
        });
      },
    },
  };
}

/**
 * The plain notation of a field: the number as typed, its `suffix` unit, and its `step` grid and bounds.
 */
function plainNotation<O extends NumberFieldOptions>(
  kind: NumericKind<O>,
  field: DashboardField<O>,
): NumericNotation {
  const { min, max, step, suffix } = field.options ?? {};
  const grid = { min, max, step };
  const unit = (): string | undefined => translateMessage(suffix);
  return {
    parse: (raw) => kind.parse(field, raw),
    text: String,
    show: String,
    unit,
    affix() {
      const symbol = unit();
      return isUndefined(symbol) ? undefined : { side: 'suffix', symbol };
    },
    check: (value) => checkRange(value, grid) ?? checkStep(value, grid),
    move: (value, count) =>
      isUndefined(step)
        ? clamp(roundTo(value + count, countDecimals(value)), min ?? -Infinity, max ?? Infinity)
        : stepValue(value, count, grid),
    decimal: kind.decimal,
    canonical: false,
  };
}

/**
 * A filter value input in a field's own notation: the typed text beside its affix, set as the stored number.
 */
function notationFilter(notation: NumericNotation, context: FieldFilterContext): Child {
  const { value, set, commit, inputID } = context;
  const current = value();
  const text = ref(isNumber(current) ? notation.text(current) : '');
  const bridged: Ref<string> = {
    get value() {
      return text.value;
    },
    set value(next) {
      text.value = next;
      const parsed = notation.parse(next).value;
      if (isNumber(parsed)) set(parsed);
    },
  };
  const shown = notation.affix();
  const symbol = isUndefined(shown)
    ? undefined
    : h('span', { class: 'ohne-numeric-affix' }, shown.symbol);
  return textInput(bridged, {
    id: inputID,
    name: inputID,
    prefix: shown?.side === 'prefix' ? symbol : undefined,
    suffix: shown?.side === 'suffix' ? symbol : undefined,
    onBlur: () => {
      const parsed = notation.parse(text.value).value;
      if (isNumber(parsed)) text.value = notation.text(parsed);
      commit();
    },
  });
}

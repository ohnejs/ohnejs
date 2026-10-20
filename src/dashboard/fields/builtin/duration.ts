import type { Ref } from '../../../utils/reactive/ref.ts';
import type { DurationFieldOptions } from '../known-field-types.ts';

import { durationText } from '../../../utils/duration/duration-text.ts';
import { formatDuration } from '../../../utils/duration/format-duration.ts';
import { parseWholeDuration } from '../../../utils/duration/parse-whole-duration.ts';
import { stringifyDuration } from '../../../utils/duration/stringify-duration.ts';
import { isNullish } from '../../../utils/is/is-nullish.ts';
import { isNumber } from '../../../utils/is/is-number.ts';
import { isUndefined } from '../../../utils/is/is-undefined.ts';
import { effect } from '../../../utils/reactive/effect.ts';
import { ref } from '../../../utils/reactive/ref.ts';
import { checkDuration } from '../../../utils/validate/check-duration.ts';
import { css } from '../../render/css.ts';
import { h } from '../../render/h.ts';
import { useDashboardLanguage } from '../../runtime/use-dashboard-language.ts';
import { translateMessage, useT } from '../../runtime/use-t.ts';
import { textInput } from '../../ui/text-input.ts';
import { checkedReading } from '../_checked-reading.ts';
import { cellEditor } from '../cell-editor.ts';
import { describeControl, fieldPlaceholder } from '../field-row.ts';
import { dimMark, type FieldType, registerFieldType } from '../field-type.ts';
import { parseDurationValue } from '../parse.ts';

css`
  .ohne-input > .ohne-duration-preview {
    min-width: 0;
    max-width: 50%;
    margin-left: 0;
    overflow: hidden;
    color: hsl(var(--ohne-muted-foreground));
    font-size: calc(1em - 0.125rem);
    white-space: nowrap;
    text-overflow: ellipsis;
  }
`;

/**
 * The `duration` field type: cell display, inline cell editor, form control, summary, and filter.
 * Every view takes text like `1h 30m` or `90m`, stored as whole milliseconds.
 * A bare number other than `0` names no unit, so it is refused.
 * The cell and summary read in the dashboard language; the cell's title is the text to type back.
 * The control previews the typed duration in words, and a valid blur rewrites the text canonically.
 * A changed value is checked against `min` and `max`, with the server's messages.
 */
export const durationType: FieldType<DurationFieldOptions> = {
  display({ value, language }) {
    return () => {
      const current = value();
      if (isNullish(current)) return dimMark('-');
      const ms = parseWholeDuration(current);
      if (isUndefined(ms) || !isNumber(current)) return String(current as string);
      return h(
        'span',
        { class: 'ohne-truncate', title: stringifyDuration(ms) },
        formatDuration(ms, { locale: language(), style: 'narrow' }),
      );
    };
  },
  summary(value) {
    const ms = isNumber(value) ? parseWholeDuration(value) : undefined;
    return isUndefined(ms) ? '' : formatDuration(ms, { locale: useDashboardLanguage().value });
  },
  editor({ field, value, commit, cancel }) {
    const current = value();
    return cellEditor({
      initial: isNullish(current) ? '' : durationText(current),
      commit(text) {
        const parsed = parseDurationValue(field, text);
        if (!isUndefined(parsed.error) || isUndefined(parsed.value)) return false;
        return commit(parsed.value);
      },
      cancel,
    });
  },
  control({ field, initial, path, disabled, language, onInput }) {
    const off = disabled === true;
    const base = ref(initial);
    const raw = ref(isNullish(initial) ? '' : durationText(initial));
    const local = ref('');
    const routed = ref('');

    const error = (): string => (routed.value !== '' ? routed.value : local.value);
    const parse = () => parseDurationValue(field, raw.value);
    // A stored value the text cannot express, like a negative, reads as stored until you edit it.
    const untouched = (): boolean =>
      !isNullish(base.value) && raw.value === durationText(base.value);
    const preview = (): string => {
      const { value } = parse();
      return isNumber(value) ? formatDuration(value, { locale: language(), style: 'long' }) : '';
    };

    const box = textInput(raw, {
      disabled: () => off,
      placeholder: fieldPlaceholder(field) ?? ((): string => '1h 30m'),
      suffix: h('span', { class: 'ohne-duration-preview' }, preview),
    });
    const input = box.querySelector('input') as HTMLInputElement;
    input.addEventListener('input', () => {
      local.value = '';
      routed.value = '';
      onInput();
    });
    input.addEventListener('blur', () => {
      if (untouched()) return;
      const parsed = parse();
      local.value = isUndefined(parsed.error) ? '' : translateMessage(parsed.error);
      if (isNumber(parsed.value)) raw.value = stringifyDuration(parsed.value);
    });
    describeControl(input, field, path, error);

    const dirty = (): boolean => {
      if (isUndefined(base.value)) return raw.value.trim() !== '';
      if (untouched()) return false;
      const parsed = parse();
      return !isUndefined(parsed.error) || parsed.value !== base.value;
    };
    const show = (value: unknown): void => {
      raw.value = isNullish(value) ? '' : durationText(value);
      local.value = '';
      routed.value = '';
    };

    return {
      element: box,
      read() {
        if (isUndefined(base.value) && raw.value.trim() === '') return {};
        if (untouched()) return { value: base.value };
        const parsed = parse();
        if (!isUndefined(parsed.error)) return { errors: { '': translateMessage(parsed.error) } };
        if (isUndefined(parsed.value)) return {};
        return checkedReading(
          parsed.value,
          isNumber(parsed.value) && dirty()
            ? checkDuration(parsed.value, field.options ?? {})
            : undefined,
        );
      },
      draft() {
        if (isUndefined(base.value) && raw.value.trim() === '') return undefined;
        if (untouched()) return base.value;
        const parsed = parse();
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
    input({ value, set, commit, inputID }) {
      const t = useT();
      const typed = ref(durationText(value()));
      let own = value();
      // Only a value set from outside, like a tree edit or a URL, rewrites what you are typing.
      effect(() => {
        const current = value();
        if (current === own) return;
        own = current;
        typed.value = durationText(current);
      });
      const bridged: Ref<string> = {
        get value() {
          return typed.value;
        },
        set value(next) {
          typed.value = next;
          const ms = parseWholeDuration(next);
          if (isUndefined(ms)) return;
          own = ms;
          set(ms);
        },
      };
      return textInput(bridged, {
        id: inputID,
        name: inputID,
        placeholder: () => t('dashboard.filter.empty'),
        onBlur: () => {
          typed.value = durationText(value());
          commit();
        },
      });
    },
  },
};

registerFieldType('duration', durationType);

import type { Ref } from '../../../utils/reactive/ref.ts';
import type { ValidationFailure } from '../../../utils/validate/validation-failure.ts';
import type { CodeFieldOptions } from '../known-field-types.ts';

import { last } from '../../../utils/array/last.ts';
import { parseFieldPath } from '../../../utils/condition/field-path.ts';
import { conditionResolver } from '../../../utils/condition/resolve-condition.ts';
import { languageOf } from '../../../utils/highlight/tokenize.ts';
import { isNull } from '../../../utils/is/is-null.ts';
import { isNullish } from '../../../utils/is/is-nullish.ts';
import { isString } from '../../../utils/is/is-string.ts';
import { isUndefined } from '../../../utils/is/is-undefined.ts';
import { ref } from '../../../utils/reactive/ref.ts';
import { lineCount } from '../../../utils/text/line-count.ts';
import { checkJSONText } from '../../../utils/validate/check-json-text.ts';
import { checkText } from '../../../utils/validate/check-text.ts';
import { css } from '../../render/css.ts';
import { h } from '../../render/h.ts';
import { useT } from '../../runtime/use-t.ts';
import { codeEditor } from '../../ui/code-editor.ts';
import { textInput } from '../../ui/text-input.ts';
import { checkedReading } from '../_checked-reading.ts';
import { describeControl, fieldPlaceholder } from '../field-row.ts';
import { dimMark, type FieldType, registerFieldType } from '../field-type.ts';
import { parseTextValue } from '../parse.ts';

css`
  .ohne-code-cell {
    display: flex;
    align-items: baseline;
    gap: 0.5em;
    min-width: 0;
  }

  .ohne-code-cell > .cell-dim {
    flex: none;
  }
`;

/**
 * The `code` field type: cell display, form control, summary, and filter.
 * The cell shows the first line in mono with the line count beside it; the full value is its title.
 * The control is a `codeEditor`, highlighted in `language` or in the language a `languageFrom` sibling names.
 * A changed value is checked against `allowEmpty`, `min`, and `max`, and parsed under `language: 'json'`.
 * An emptied control writes `null` on a nullable field, the empty string otherwise.
 */
export const codeType: FieldType<CodeFieldOptions> = {
  display({ value }) {
    const t = useT();
    return () => {
      const current = value();
      if (isNullish(current)) return dimMark('-');
      const text = String(current as string);
      if (text === '') return h('span', { class: 'cell-faint cell-mono' }, '""');
      const count = lineCount(text);
      return h(
        'span',
        { class: 'ohne-code-cell', title: text },
        h('span', { class: 'cell-mono ohne-truncate' }, text.split('\n', 1)[0]),
        count > 1 ? h('span', { class: 'cell-dim' }, t('dashboard.code.lines', { count })) : null,
      );
    };
  },
  summary(value) {
    return isString(value) ? value.split('\n', 1)[0] : '';
  },
  control({ field, initial, path, disabled, onInput, ancestors }) {
    const { language, languageFrom, indent, wrap } = field.options ?? {};
    const json = languageOf(language ?? '') === 'json';
    const from = isUndefined(languageFrom) ? undefined : parseFieldPath(languageFrom);
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
    const named = (): string => {
      const scopes = ancestors?.() ?? [];
      if (isUndefined(from) || scopes.length === 0) return '';
      const value = conditionResolver(last(scopes)!, scopes.slice(0, -1))(from);
      return isString(value) ? value : '';
    };
    const element = codeEditor(model, {
      language: language ?? named,
      indent,
      wrap,
      placeholder: fieldPlaceholder(field),
      disabled: () => disabled === true,
    });
    const area = element.querySelector('textarea') as HTMLTextAreaElement;
    describeControl(area, field, path, error);

    const wire = (): unknown => {
      if (raw.value !== '') return raw.value;
      return base.value === '' ? '' : parseTextValue(field, '');
    };
    const dirty = (): boolean => {
      if (isUndefined(base.value)) return raw.value !== '';
      return wire() !== (isNull(base.value) ? null : String(base.value as string));
    };
    const check = (value: string): ValidationFailure | undefined =>
      checkText(value, field.options) ?? (json && value !== '' ? checkJSONText(value) : undefined);
    const draft = (): unknown => (isUndefined(base.value) && raw.value === '' ? undefined : wire());
    const show = (value: unknown): void => {
      raw.value = isNullish(value) ? '' : String(value as string);
      routed.value = '';
    };

    return {
      element,
      read() {
        const value = draft();
        if (isUndefined(value)) return {};
        return checkedReading(value, isString(value) && dirty() ? check(value) : undefined);
      },
      draft,
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
  filter: {
    operators: () => ['contains', 'notContains'],
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
        spellcheck: false,
        placeholder: () => t('dashboard.filter.empty'),
        onBlur: () => commit(),
      });
    },
  },
};

registerFieldType('code', codeType);

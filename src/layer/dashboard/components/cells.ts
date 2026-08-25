import {
  button,
  cellEditor,
  css,
  describeControl,
  dimMark,
  h,
  icon,
  registerFieldType,
  textInput,
  useT,
} from 'ohne/dashboard';
import { batchedEffect, deepEqual, isArray, isNull, isString, isUndefined, ref } from 'ohne/utils';

css`
  .ohne-password {
    position: relative;
  }

  .ohne-password .ohne-input {
    padding-right: 30px;
  }

  .ohne-password .ohne-button {
    position: absolute;
    top: 2px;
    right: 2px;
    width: 24px;
    height: 24px;
    padding: 0;
  }
`;

// The hash never reaches the browser: the display is a fixed mark, an emptied editor cancels,
// and a pristine or emptied control omits - a password is never cleared from here.
registerFieldType('password', {
  display() {
    return dimMark('···');
  },
  editor({ commit, cancel }) {
    return cellEditor({
      initial: '',
      type: 'password',
      commit: (text) => (text === '' ? cancel() : commit(text)),
      cancel,
    });
  },
  control({ field, mode, path, onInput }) {
    const t = useT();
    const raw = ref('');
    const routed = ref('');
    const revealed = ref(false);

    const error = (): string => routed.value;
    const input = textInput(raw, {
      type: () => (revealed.value ? 'text' : 'password'),
      placeholder: mode === 'edit' ? () => t('dashboard.field.unchanged') : undefined,
    });
    input.addEventListener('input', () => {
      routed.value = '';
      onInput();
    });
    describeControl(input, field, path, error);

    const reveal = button(() => icon(revealed.value ? 'eye-off' : 'eye'), {
      variant: 'ghost',
      ariaLabel: t('dashboard.field.reveal'),
      onClick: () => {
        revealed.value = !revealed.value;
      },
    });

    return {
      element: h('div', { class: 'ohne-password' }, input, reveal),
      read() {
        return raw.value === '' ? {} : { value: raw.value };
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
        return raw.value !== '';
      },
      focus() {
        input.focus();
      },
      revert() {
        raw.value = '';
        routed.value = '';
      },
      rebase() {
        raw.value = '';
        routed.value = '';
      },
    };
  },
});

css`
  .ohne-roles {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    box-sizing: border-box;
    width: 100%;
    min-height: 28px;
    padding: 3px;
    background: var(--bg);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius);
    cursor: text;
    transition:
      border-color var(--pace),
      box-shadow var(--pace);
  }

  .ohne-roles:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-wash);
  }

  .ohne-role {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 4px 1px 6px;
    background: var(--raised);
    border: 1px solid var(--line-strong);
    border-radius: 3px;
    font: 400 var(--fs-small) var(--mono);
    color: var(--text);
  }

  .ohne-role-x {
    border: none;
    background: none;
    padding: 0;
    color: var(--dim);
    font-size: 10px;
    line-height: 1;
    cursor: pointer;
  }

  .ohne-role-x:hover {
    color: var(--text);
  }

  .ohne-roles-input {
    flex: 1;
    min-width: 60px;
    border: none;
    outline: none;
    background: none;
    color: var(--text);
    font: inherit;
  }
`;

// Role names edit as a comma-separated list in the cell and as token chips in the form;
// unknown names reject server-side onto the cell or the row.
registerFieldType('roles', {
  display({ value }) {
    return () => {
      const current = value();
      if (!isArray(current) || current.length === 0) return dimMark('·');
      return current.filter(isString).join(', ');
    };
  },
  editor({ value, commit, cancel }) {
    const current = value();
    return cellEditor({
      initial: isArray(current) ? current.filter(isString).join(', ') : '',
      commit(text) {
        commit(
          text
            .split(',')
            .map((role) => role.trim())
            .filter((role) => role !== ''),
        );
      },
      cancel,
    });
  },
  control({ field, initial, path, onInput }) {
    let base = initial;
    const stored = (): string[] => (isArray(base) ? base.filter(isString) : []);
    const list = ref<readonly string[]>(stored());
    const draft = ref('');
    const routed = ref('');

    const error = (): string => routed.value;
    const touch = (): void => {
      routed.value = '';
      onInput();
    };
    const commitDraft = (): void => {
      const role = draft.value.trim();
      draft.value = '';
      if (role !== '') list.value = [...list.value, role];
    };

    const input = h('input', { class: 'ohne-roles-input', type: 'text' }) as HTMLInputElement;
    input.addEventListener('input', () => {
      draft.value = input.value;
      touch();
    });
    batchedEffect(() => {
      if (input.value !== draft.value) input.value = draft.value;
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        // An empty draft falls through, so Enter still submits the hosting form.
        if (draft.value.trim() === '') return;
        event.preventDefault();
        commitDraft();
        touch();
      } else if (event.key === ',') {
        event.preventDefault();
        commitDraft();
        touch();
      } else if (event.key === 'Backspace' && input.value === '' && list.value.length > 0) {
        list.value = list.value.slice(0, -1);
        touch();
      }
    });
    describeControl(input, field, path, error);

    const wire = (): unknown => {
      if (list.value.length > 0) return [...list.value];
      if (isArray(base) && base.length === 0) return [];
      return field.nullable ? null : [];
    };

    return {
      element: h(
        'div',
        { class: 'ohne-roles', onClick: () => input.focus() },
        () =>
          list.value.map((role, index) =>
            h(
              'span',
              { class: 'ohne-role' },
              role,
              h(
                'button',
                {
                  class: 'ohne-role-x',
                  type: 'button',
                  tabindex: '-1',
                  onClick: () => {
                    list.value = list.value.filter((_, at) => at !== index);
                    touch();
                  },
                },
                '✕',
              ),
            ),
          ),
        input,
      ),
      read() {
        commitDraft();
        if (isUndefined(base) && list.value.length === 0) return {};
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
        if (draft.value !== '') return true;
        if (isUndefined(base)) return list.value.length > 0;
        return !deepEqual(wire(), isNull(base) ? null : stored());
      },
      focus() {
        input.focus();
      },
      revert() {
        list.value = stored();
        draft.value = '';
        routed.value = '';
      },
      rebase(value) {
        base = value;
        routed.value = '';
      },
    };
  },
});

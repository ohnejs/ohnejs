import {
  button,
  cellEditor,
  type ChipsChoice,
  chips,
  css,
  dashboardMeta,
  describeControl,
  dimMark,
  h,
  icon,
  type Primitive,
  registerFieldType,
  select,
  type SelectChoice,
  textInput,
  useT,
} from 'ohne/dashboard';
import {
  deepEqual,
  effect,
  isArray,
  isNull,
  isString,
  isUndefined,
  type Ref,
  ref,
  untracked,
} from 'ohne/utils';

import '../components/data-table-popup.ts';

css`
  .ohne-roles-field {
    align-items: flex-start;
  }
`;

// The hash never reaches the browser and an emptied field omits, so a password is never cleared here.
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
  control({ field, mode, path, disabled, onInput }) {
    const t = useT();
    const off = disabled === true;
    const raw = ref('');
    const routed = ref('');
    const revealed = ref(false);

    const error = (): string => routed.value;

    // One persistent button whose icon swaps in place, so a click never unmounts the focused node.
    const reveal = button(
      () => {
        const glyph = icon(revealed.value ? 'eye' : 'eye-off');
        glyph.setAttribute('width', '1.125em');
        glyph.setAttribute('height', '1.125em');
        return glyph;
      },
      {
        variant: 'ghost',
        disabled: off ? (): boolean => true : undefined,
        onClick: () => {
          revealed.value = !revealed.value;
        },
      },
    );
    reveal.tabIndex = -1;
    // `button` takes a static variant, so the classes patch here; its class attribute is not reactive.
    effect(() => {
      reveal.classList.toggle('ohne-button-accent', revealed.value);
      reveal.classList.toggle('ohne-button-ghost', !revealed.value);
      reveal.title = t(
        revealed.value ? 'dashboard.field.hidePassword' : 'dashboard.field.showPassword',
      );
    });

    const root = textInput(raw, {
      disabled: () => off,
      type: () => (revealed.value ? 'text' : 'password'),
      placeholder: mode === 'edit' ? () => t('dashboard.field.unchanged') : undefined,
      autocomplete: 'new-password',
      suffix: reveal,
    });
    const input = root.querySelector('input') as HTMLInputElement;
    input.addEventListener('input', () => {
      routed.value = '';
      onInput();
    });
    describeControl(input, field, path, error);

    return {
      element: root,
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

registerFieldType('roles', {
  display({ value }) {
    return () => {
      const current = value();
      const names = isArray(current) ? current.filter(isString) : [];
      if (names.length === 0) return dimMark('-');
      const joined = names.length <= 3 ? names.join(', ') : (names[0] as string);
      return [
        h('span', { class: 'ohne-truncate', title: joined }, joined),
        names.length > 3 ? dimMark(` +${names.length - 1}`) : null,
      ];
    };
  },
  control(context) {
    const t = useT();
    let base = listOf(context.initial);
    const model = ref<string[]>([...base]);
    const touched = ref(false);
    const routed = ref('');
    const erroredIndices = ref<number[]>([]);

    // The chips write `model` directly; `silent` mutes the effect's first run, revert, and rebase.
    let silent = true;
    effect(() => {
      void model.value;
      if (silent) return;
      untracked(() => {
        touched.value = true;
        routed.value = '';
        erroredIndices.value = [];
        context.onInput();
      });
    });
    silent = false;

    const reset = (next: readonly string[]): void => {
      silent = true;
      model.value = [...next];
      silent = false;
      touched.value = false;
      routed.value = '';
      erroredIndices.value = [];
    };

    const element = chips(model, {
      disabled: () => context.disabled === true,
      choices: () => (dashboardMeta()?.roles ?? []).map((name): ChipsChoice => ({ value: name })),
      error: () => routed.value !== '',
      erroredItems: () => erroredIndices.value,
      name: context.path,
      noResultsLabel: untracked(() => t('dashboard.noResultsFound')),
      removeItemLabel: untracked(() => t('dashboard.removeItem')),
    });
    const input = element.querySelector<HTMLInputElement>('.ohne-chips-input');
    if (!isNull(input)) describeControl(input, context.field, context.path, () => routed.value);

    return {
      element: h('div', { class: 'ohne-roles-field ohne-row' }, element),
      read() {
        if (!touched.value && isUndefined(context.initial)) return {};
        return { value: model.value };
      },
      setErrors(errors) {
        routed.value = errors[''] ?? '';
        const marked: number[] = [];
        let unplaced = '';
        for (const [key, message] of Object.entries(errors)) {
          if (key === '') continue;
          const match = /^\[(\d+)\]$/.exec(key);
          if (isNull(match)) {
            if (unplaced === '') unplaced = message;
          } else {
            marked.push(Number(match[1]));
          }
        }
        erroredIndices.value = marked;
        return unplaced;
      },
      error: () => routed.value,
      errored: () => erroredIndices.value.length > 0,
      dirty: () => touched.value && !deepEqual(model.value, base),
      focus: () => input?.focus(),
      revert() {
        reset(base);
      },
      rebase(value) {
        base = listOf(value);
        reset(base);
      },
    };
  },
  filter: {
    operators: () => ['includes', 'notIncludes'],
    seed: () => dashboardMeta()?.roles[0] ?? '',
    input({ value, commit, inputID }) {
      const bridged: Ref<Primitive> = {
        get value() {
          return value();
        },
        set value(next) {
          commit(String(next));
        },
      };
      return select(
        bridged,
        (): SelectChoice[] => (dashboardMeta()?.roles ?? []).map((name) => ({ value: name })),
        { id: inputID, name: inputID },
      );
    },
  },
});

/**
 * The stored value as a role-name list, malformed entries dropped.
 */
function listOf(value: unknown): readonly string[] {
  return isArray(value) ? value.filter(isString) : [];
}

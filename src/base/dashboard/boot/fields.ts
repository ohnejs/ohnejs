import {
  button,
  cellEditor,
  type ChipsChoice,
  chips,
  css,
  dashboardMeta,
  dateTimePreferences,
  describeControl,
  dimMark,
  type DynamicSelectChoice,
  type DynamicSelectPaginatedChoices,
  dynamicSelect,
  type FieldControl,
  type FieldControlContext,
  type FieldType,
  h,
  icon,
  type Primitive,
  registerFieldType,
  select,
  type SelectChoice,
  textInput,
  timezones,
  useT,
} from 'ohnejs/dashboard';
import {
  capitalize,
  deepEqual,
  effect,
  first,
  formatDatePattern,
  isArray,
  isEmpty,
  isNull,
  isString,
  isUndefined,
  onCleanup,
  type Ref,
  ref,
  searchByKeywords,
  untracked,
} from 'ohnejs/utils';

import { localeName } from '../components/content-language-switcher.ts';
import '../components/data-table-popup.ts';

css`
  .ohne-roles-field {
    align-items: flex-start;
  }

  .o-date-pattern-preview {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    max-width: calc(50% - 0.25rem);
    height: 2rem;
    padding: 0 0.5rem;
    background-color: hsl(var(--ohne-accent));
    border-radius: calc(var(--ohne-radius) - 0.125rem);
    color: hsl(var(--ohne-accent-foreground));
    font-family: var(--ohne-font-mono);
    font-size: 0.8125rem;
  }

  @container (max-width: 768px) {
    .o-date-pattern-preview > :first-child {
      display: none;
    }
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
      const labels = isArray(current) ? current.filter(isString).map(roleLabelOf) : [];
      if (labels.length === 0) return dimMark('-');
      const joined = labels.length <= 3 ? labels.join(', ') : (labels[0] as string);
      return [
        h('span', { class: 'ohne-truncate', title: joined }, joined),
        labels.length > 3 ? dimMark(` +${labels.length - 1}`) : null,
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
      choices: () =>
        (dashboardMeta()?.roles ?? []).map(
          ({ name, label, description }): ChipsChoice => ({
            value: name,
            label,
            tooltip: description,
          }),
        ),
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
    seed: () => dashboardMeta()?.roles[0]?.name ?? '',
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
        (): SelectChoice[] =>
          (dashboardMeta()?.roles ?? []).map(({ name, label }) => ({ value: name, label })),
        { id: inputID, name: inputID },
      );
    },
  },
});

registerFieldType(
  'language',
  codeType(() => dashboardMeta()?.languages ?? [], languageName),
);

registerFieldType(
  'locale',
  codeType(() => dashboardMeta()?.locales ?? [], localeName),
);

registerFieldType('timezone', {
  display({ value }) {
    return () => {
      const current = value();
      if (!isString(current)) return dimMark('-');
      return h('span', { class: 'ohne-truncate', title: current }, current);
    };
  },
  control(context) {
    const t = useT();
    let combobox: HTMLElement | null = null;
    return codeControl(context, (model, commit, error) => ({
      // `placeholder` is static, so the picker rebuilds when its catalog lands or the language changes.
      element: h('div', null, () => {
        const auto = t('auth.timezone.auto');
        const searchLabel = t('dashboard.searchPlaceholder');
        const noResultsLabel = t('dashboard.noResultsFound');
        const picker = untracked(() =>
          dynamicSelect(model, {
            choicesResolver: (page, keyword) => Promise.resolve(timezonePage(page, keyword, auto)),
            selectedChoiceResolver: (value) => Promise.resolve({ value, label: String(value) }),
            placeholder: auto,
            searchLabel,
            noResultsLabel,
            disabled: () => context.disabled === true,
            error: () => error() !== '',
            name: context.path,
            onCommit: commit,
          }),
        );
        combobox = picker.querySelector<HTMLElement>('[role="combobox"]');
        if (!isNull(combobox)) describeControl(combobox, context.field, context.path, error);
        return picker;
      }),
      focus: () => combobox?.focus(),
    }));
  },
});

registerFieldType('datePattern', {
  display({ value }) {
    return () => {
      const current = value();
      if (!isString(current) || isEmpty(current)) return dimMark('-');
      return h('span', { class: 'cell-mono ohne-truncate', title: current }, current);
    };
  },
  control({ field, initial, path, disabled, onInput }) {
    const t = useT();
    const off = disabled === true;
    const patternOf = (value: unknown): string => (isString(value) ? value : '');
    let base = initial;
    // A ref, so a rebase re-evaluates the row's dirt; a plain baseline would leave the dot stale.
    const stored = ref(patternOf(base));
    const raw = ref(stored.value);
    const routed = ref('');
    const now = ref(Date.now());

    const error = (): string => routed.value;

    const timer = setInterval(() => {
      now.value = Date.now();
    }, 1000);
    onCleanup(() => clearInterval(timer));

    const preview = h(
      'span',
      { class: 'o-date-pattern-preview' },
      h('span', { class: 'ohne-shrink-0' }, () => `${t('dashboard.account.preview')}:`),
      h('span', { class: 'ohne-truncate' }, () => {
        const pattern = raw.value.trim();
        if (pattern === '') return '-';
        const { language, timeZone } = dateTimePreferences();
        return formatDatePattern(now.value, pattern, { language, timeZone });
      }),
    );

    const box = textInput(raw, {
      disabled: () => off,
      placeholder: field.placeholder,
    });
    const input = box.querySelector('input') as HTMLInputElement;
    input.addEventListener('input', () => {
      routed.value = '';
      onInput();
    });
    describeControl(input, field, path, error);

    return {
      element: h('div', { class: 'ohne-row' }, box, preview),
      read() {
        if (isUndefined(base) && raw.value === '') return {};
        return { value: raw.value };
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
        return raw.value !== stored.value;
      },
      focus() {
        input.focus();
      },
      revert() {
        raw.value = stored.value;
        routed.value = '';
      },
      rebase(value) {
        base = value;
        stored.value = patternOf(value);
        routed.value = '';
      },
    };
  },
});

/**
 * The stored value as a role-name list, malformed entries dropped.
 */
function listOf(value: unknown): readonly string[] {
  return isArray(value) ? value.filter(isString) : [];
}

/**
 * A role's served label; a name no role declares any more shows as is.
 */
function roleLabelOf(name: string): string {
  return dashboardMeta()?.roles.find((role) => role.name === name)?.label ?? name;
}

/**
 * A field type over a runtime list of codes, with `null` for the app default.
 * The cell shows the stored code through `label`; the control and the filter select from `list`, reactively.
 * The control leads with a muted null row, since every code field of the kind stores `null` for auto.
 */
function codeType(list: () => string[], label: (code: string) => string): FieldType {
  const choices = (): SelectChoice[] => list().map((code) => ({ value: code, label: label(code) }));
  return {
    display({ value }) {
      return () => {
        const current = value();
        if (!isString(current)) return dimMark('-');
        return h('span', { class: 'ohne-truncate', title: current }, label(current));
      };
    },
    control(context) {
      const t = useT();
      let combobox: HTMLElement | null = null;
      return codeControl(context, (model, commit, error) => {
        const element = select(
          model,
          () => [
            { value: null, label: t('dashboard.account.appDefault'), muted: true },
            ...choices(),
          ],
          {
            disabled: () => context.disabled === true,
            error: () => error() !== '',
            name: context.path,
            placeholder: context.field.placeholder,
            onCommit: commit,
          },
        );
        combobox = element.querySelector<HTMLElement>('[role="combobox"]');
        if (!isNull(combobox)) describeControl(combobox, context.field, context.path, error);
        return { element, focus: () => combobox?.focus() };
      });
    },
    filter: {
      operators: () => ['eq', 'ne'],
      seed: () => first(list()) ?? '',
      input({ value, commit, inputID }) {
        const bridged: Ref<Primitive> = {
          get value() {
            return value();
          },
          set value(next) {
            commit(String(next));
          },
        };
        return select(bridged, choices, { id: inputID, name: inputID });
      },
    },
  };
}

/**
 * A control over one nullable code, shared by the language, locale, and time zone types.
 * `build` renders the picker over the model and routes its commits; the handle owns touch, dirt, and errors.
 * Untouched, the control reads back the stored value unchanged, as the builtin `select` does.
 */
function codeControl(
  { initial, onInput }: FieldControlContext,
  build: (
    model: Ref<Primitive>,
    commit: (next: Primitive) => void,
    error: () => string,
  ) => Pick<FieldControl, 'element' | 'focus'>,
): FieldControl {
  let base = initial;
  const model = ref<Primitive>(isString(base) ? base : null);
  const touched = ref(false);
  const routed = ref('');

  const error = (): string => routed.value;
  const current = (): string | null => (isString(model.value) ? model.value : null);
  const wire = (): string | null => (touched.value ? current() : isString(base) ? base : null);

  const picker = build(
    model,
    (next) => {
      model.value = isString(next) ? next : null;
      touched.value = true;
      routed.value = '';
      onInput();
    },
    error,
  );

  return {
    element: picker.element,
    read() {
      if (!touched.value && isUndefined(base)) return {};
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
      return touched.value && wire() !== (isUndefined(base) ? undefined : (base ?? null));
    },
    focus: picker.focus,
    revert() {
      model.value = isString(base) ? base : null;
      touched.value = false;
      routed.value = '';
    },
    rebase(value) {
      base = value;
      model.value = isString(value) ? value : null;
      touched.value = false;
      routed.value = '';
    },
  };
}

/**
 * A language's name in itself, like `Deutsch` for `de`, falling back to the tag.
 * The name is capitalized, since some languages spell their own name lowercase.
 */
function languageName(code: string): string {
  try {
    return capitalize(new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code);
  } catch {
    return code;
  }
}

const TIMEZONE_CHOICES: DynamicSelectChoice[] = timezones.map((value) => ({ value }));

const TIMEZONES_PER_PAGE = 50;

/**
 * One page of the time zone picker, from the zones matching `keyword`.
 * With no keyword, the `auto` row leads the full list.
 */
function timezonePage(page: number, keyword: string, auto: string): DynamicSelectPaginatedChoices {
  const matches = isEmpty(keyword, { trim: true })
    ? [{ value: null, label: auto }, ...TIMEZONE_CHOICES]
    : searchByKeywords(TIMEZONE_CHOICES, keyword, 'value');
  const start = (page - 1) * TIMEZONES_PER_PAGE;
  return {
    choices: matches.slice(start, start + TIMEZONES_PER_PAGE),
    currentPage: page,
    lastPage: Math.max(1, Math.ceil(matches.length / TIMEZONES_PER_PAGE)),
    perPage: TIMEZONES_PER_PAGE,
    total: matches.length,
  };
}

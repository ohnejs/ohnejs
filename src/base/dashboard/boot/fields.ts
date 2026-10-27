import {
  button,
  cellEditor,
  chips,
  type ChipsChoice,
  css,
  dashboardMeta,
  dateTimePreferences,
  describeControl,
  dimMark,
  dynamicSelect,
  type DynamicSelectChoice,
  type DynamicSelectPaginatedChoices,
  type FieldControl,
  type FieldControlContext,
  fieldPlaceholder,
  type FieldType,
  h,
  icon,
  type Primitive,
  registerFieldType,
  type RoleName,
  select,
  type SelectChoice,
  textInput,
  timezones,
  translateMessage,
  useDashboardLanguage,
  useT,
} from 'ohnejs/dashboard';
import {
  type CountryCode,
  countryCodes,
  type CurrencyCode,
  currencyCodes,
  deepEqual,
  displayName,
  effect,
  first,
  foldCase,
  formatDatePattern,
  isArray,
  isEmpty,
  isNull,
  isString,
  isUndefined,
  matchesCodeOrName,
  onCleanup,
  type Ref,
  ref,
  searchByKeywords,
  untracked,
} from 'ohnejs/utils';

import '../components/data-table-popup.ts';

declare module 'ohnejs/dashboard' {
  interface KnownFieldTypes {
    /**
     * A password, written but never read back; an emptied field keeps the stored hash.
     */
    password: { options: {}; value: string };

    /**
     * The roles a user holds.
     */
    roles: { options: {}; value: RoleName[] };

    /**
     * A dashboard language tag, one of the languages the message catalogs define.
     */
    language: { options: {}; value: string };

    /**
     * A content locale code, one of the locales the app declares.
     */
    locale: { options: {}; value: string };

    /**
     * An IANA timezone name.
     */
    timezone: { options: {}; value: string };

    /**
     * A date format pattern, like `DD.MM.YYYY`.
     */
    datePattern: { options: {}; value: string };

    /**
     * An ISO 3166-1 alpha-2 country code, shown by its name.
     */
    country: { options: { only?: readonly CountryCode[] }; value: CountryCode };

    /**
     * An ISO 4217 currency code, shown by its name.
     */
    currency: { options: { only?: readonly CurrencyCode[] }; value: CurrencyCode };
  }
}

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

// The control never shows a stored value and an emptied field omits, so a password is never cleared here.
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
      reveal.setAttribute('aria-label', reveal.title);
      reveal.setAttribute('aria-pressed', String(revealed.value));
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
      // An empty draft still names the field, so a restore never falls back to the stored hash.
      draft() {
        return raw.value;
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
      restore(value) {
        raw.value = isString(value) ? value : '';
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

    const reset = (next: readonly string[], asTouched = false): void => {
      silent = true;
      model.value = [...next];
      silent = false;
      touched.value = asTouched;
      routed.value = '';
      erroredIndices.value = [];
    };

    const element = chips(model, {
      disabled: () => context.disabled === true,
      choices: () =>
        (dashboardMeta()?.roles ?? []).map(({ name, label, description }): ChipsChoice => ({
          value: name,
          label: translateMessage(label),
          tooltip: isUndefined(description) ? undefined : translateMessage(description),
        })),
      erroredItems: () => erroredIndices.value,
      name: context.path,
      noResultsLabel: () => t('dashboard.noResultsFound'),
      removeItemLabel: () => t('dashboard.removeItem'),
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
      restore(value) {
        if (isUndefined(value)) reset(base);
        else reset(listOf(value), true);
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
          (dashboardMeta()?.roles ?? []).map(({ name, label }) => ({
            value: name,
            label: translateMessage(label),
          })),
        { id: inputID, name: inputID },
      );
    },
  },
});

registerFieldType(
  'language',
  codeType(
    () => dashboardMeta()?.languages ?? [],
    (code) => displayName(code, 'language', code),
  ),
);

registerFieldType(
  'locale',
  codeType(
    () => dashboardMeta()?.locales ?? [],
    (code) => displayName(code, 'language', code),
  ),
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
    return codeControl(context, (model, commit, error) => {
      const picker = dynamicSelect(model, {
        choicesResolver: (page, keyword) =>
          choicePage(
            isEmpty(keyword, { trim: true })
              ? [{ value: null, label: t('auth.timezone.auto') }, ...TIMEZONE_CHOICES]
              : searchByKeywords(TIMEZONE_CHOICES, keyword, 'value'),
            page,
          ),
        selectedChoiceResolver: (value) => Promise.resolve({ value, label: String(value) }),
        placeholder: () => t('auth.timezone.auto'),
        searchLabel: () => t('dashboard.searchPlaceholder'),
        noResultsLabel: () => t('dashboard.noResultsFound'),
        disabled: () => context.disabled === true,
        name: context.path,
        onCommit: commit,
      });
      combobox = picker.querySelector<HTMLElement>('[role="combobox"]');
      if (!isNull(combobox)) describeControl(combobox, context.field, context.path, error);
      return {
        element: picker,
        focus: () => combobox?.focus(),
      };
    });
  },
});

registerFieldType('country', isoCodeType(countryCodes, 'region'));

registerFieldType('currency', isoCodeType(currencyCodes, 'currency'));

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

    // A ref in between, so a tick that formats the same text again never touches the text node.
    const shown = ref('');
    effect(() => {
      const pattern = raw.value.trim();
      const { language, timeZone } = dateTimePreferences();
      shown.value = isEmpty(pattern)
        ? '-'
        : formatDatePattern(now.value, pattern, { language, timeZone });
    });

    const preview = h(
      'span',
      { class: 'o-date-pattern-preview' },
      h('span', { class: 'ohne-shrink-0' }, () => `${t('dashboard.account.preview')}:`),
      h('span', { class: 'ohne-truncate' }, () => shown.value),
    );

    const box = textInput(raw, {
      disabled: () => off,
      placeholder: fieldPlaceholder(field),
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
      restore(value) {
        raw.value = isUndefined(value) ? stored.value : patternOf(value);
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
 * A role's label in the dashboard language; a name no role declares any more shows as is.
 */
function roleLabelOf(name: string): string {
  const role = dashboardMeta()?.roles.find((entry) => entry.name === name);
  return isUndefined(role) ? name : translateMessage(role.label);
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
            name: context.path,
            placeholder: fieldPlaceholder(context.field),
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
 * A field type over a fixed list of ISO codes, each shown by its name in the dashboard language.
 * The cell and summary show the name, the code its title; `only` narrows the list.
 * The control picks from the names, sorted, matching a search on the exact code or a word start of the name.
 * A search's exact code leads the matches.
 * A nullable field leads its picker with a `-` row that clears the value.
 */
function isoCodeType(codes: readonly string[], kind: 'region' | 'currency'): FieldType {
  const namedCodes = (
    only: unknown,
    language: string,
    keyword = '',
  ): { code: string; name: string }[] => {
    const collator = new Intl.Collator(language);
    const token = keyword.trim();
    const exact = ({ code }: { code: string }): number =>
      foldCase(code) === foldCase(token) ? 0 : 1;
    return (isArray<string[]>(only) ? only : codes)
      .map((code) => ({ code, name: displayName(code, kind, language) }))
      .filter(({ code, name }) => token === '' || matchesCodeOrName(code, name, token))
      .sort((a, b) => exact(a) - exact(b) || collator.compare(a.name, b.name));
  };
  const choicesOf = (only: unknown, language: string, keyword?: string): DynamicSelectChoice[] =>
    namedCodes(only, language, keyword).map(({ code, name }) => ({
      value: code,
      label: () => name,
      badge: code,
    }));
  const selected = (code: Primitive, language: () => string): DynamicSelectChoice => ({
    value: code,
    label: () => displayName(String(code), kind, language()),
    badge: String(code),
  });
  return {
    display({ value, language }) {
      return () => {
        const current = value();
        if (!isString(current)) return dimMark('-');
        return h(
          'span',
          { class: 'ohne-truncate', title: current },
          displayName(current, kind, language()),
        );
      };
    },
    summary(value) {
      return isString(value) ? displayName(value, kind, useDashboardLanguage().value) : '';
    },
    control(context) {
      const t = useT();
      const { field } = context;
      let combobox: HTMLElement | null = null;
      return codeControl(context, (model, commit, error) => {
        const picker = dynamicSelect(model, {
          choicesResolver: (page, keyword) => {
            const lead =
              field.nullable && isEmpty(keyword, { trim: true })
                ? [{ value: null, label: () => '-' }]
                : [];
            return choicePage(
              [...lead, ...choicesOf(field.options?.only, context.language(), keyword)],
              page,
            );
          },
          selectedChoiceResolver: (value) => Promise.resolve(selected(value, context.language)),
          placeholder: fieldPlaceholder(field),
          searchLabel: () => t('dashboard.searchPlaceholder'),
          noResultsLabel: () => t('dashboard.noResultsFound'),
          disabled: () => context.disabled === true,
          name: context.path,
          onCommit: commit,
        });
        combobox = picker.querySelector<HTMLElement>('[role="combobox"]');
        if (!isNull(combobox)) describeControl(combobox, field, context.path, error);
        return { element: picker, focus: () => combobox?.focus() };
      });
    },
    filter: {
      operators: () => ['eq', 'ne'],
      seed: (field) =>
        first(namedCodes(field.options?.only, useDashboardLanguage().value))?.code ?? '',
      input({ field, value, commit, inputID, language }) {
        const t = useT();
        const bridged: Ref<Primitive> = {
          get value() {
            return value();
          },
          set value(next) {
            commit(String(next));
          },
        };
        return dynamicSelect(bridged, {
          choicesResolver: (page, keyword) =>
            choicePage(choicesOf(field.options?.only, language(), keyword), page),
          selectedChoiceResolver: (code) => Promise.resolve(selected(code, language)),
          searchLabel: () => t('dashboard.searchPlaceholder'),
          noResultsLabel: () => t('dashboard.noResultsFound'),
          name: inputID,
        });
      },
    },
  };
}

/**
 * A control over one code, shared by every code type: language, locale, time zone, country, and currency.
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
    restore(value) {
      model.value = isString(value) ? value : isUndefined(value) && isString(base) ? base : null;
      touched.value = !isUndefined(value);
      routed.value = '';
    },
  };
}

const TIMEZONE_CHOICES: DynamicSelectChoice[] = timezones.map((value) => ({ value }));

const CHOICES_PER_PAGE = 50;

/**
 * One page of a long picker's matching choices.
 */
function choicePage(
  matches: readonly DynamicSelectChoice[],
  page: number,
): Promise<DynamicSelectPaginatedChoices> {
  const start = (page - 1) * CHOICES_PER_PAGE;
  return Promise.resolve({
    choices: matches.slice(start, start + CHOICES_PER_PAGE),
    currentPage: page,
    lastPage: Math.max(1, Math.ceil(matches.length / CHOICES_PER_PAGE)),
    perPage: CHOICES_PER_PAGE,
    total: matches.length,
  });
}

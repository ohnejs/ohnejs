import {
  type ChipsChoice,
  chips,
  css,
  dashboardMeta,
  describeControl,
  dimMark,
  h,
  registerFieldType,
  useT,
} from 'ohne/dashboard';
import {
  deepEqual,
  effect,
  isArray,
  isNull,
  isString,
  isUndefined,
  ref,
  untracked,
} from 'ohne/utils';

css`
  .ohne-roles-field {
    align-items: flex-start;
  }
`;

// Cells join the names, summarizing four or more as the first plus a dim `+n` tail.
// There is no inline cell editor: the list edits in the record form's choice-restricted chips,
// whose dropdown offers the meta's registered role names; unknown names reject server-side.
registerFieldType('roles', {
  display({ value }) {
    return () => {
      const current = value();
      const names = isArray(current) ? current.filter(isString) : [];
      if (names.length === 0) return dimMark('·');
      if (names.length <= 3) return names.join(', ');
      return [names[0] as string, dimMark(` +${names.length - 1}`)];
    };
  },
  control(context) {
    const t = useT();
    let base = listOf(context.initial);
    const model = ref<string[]>([...base]);
    const touched = ref(false);
    const routed = ref('');
    const erroredIndices = ref<number[]>([]);

    // The chips write the model directly on add, remove, and reorder; this relays every write
    // after the first into the control's change bookkeeping. `silent` mutes revert and rebase.
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
});

/**
 * The stored value as a role-name list, malformed entries dropped.
 */
function listOf(value: unknown): readonly string[] {
  return isArray(value) ? value.filter(isString) : [];
}

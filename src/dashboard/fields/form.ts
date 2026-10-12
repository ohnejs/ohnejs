import type { FieldLayout } from '../../utils/field-layout/field-layout.ts';
import type { Ref } from '../../utils/reactive/ref.ts';
import type { Text } from '../runtime/text-type.ts';
import type { FieldForm } from './field-form.ts';
import type {
  CommonFieldOptions,
  FieldSpec,
  FieldSpecs,
  FieldTypeName,
  FieldValue,
  FormValue,
} from './known-field-types.ts';

import { first } from '../../utils/array/first.ts';
import { layoutProblems } from '../../utils/field-layout/layout-problems.ts';
import { resolveLayoutNodes } from '../../utils/field-layout/resolve-layout-nodes.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { deepEqual } from '../../utils/object/deep-equal.ts';
import { hasKey } from '../../utils/object/has-key.ts';
import { computed } from '../../utils/reactive/computed.ts';
import { effectScope, onCleanup } from '../../utils/reactive/effect-scope.ts';
import { effect } from '../../utils/reactive/effect.ts';
import { ref } from '../../utils/reactive/ref.ts';
import { untracked } from '../../utils/reactive/untracked.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { useUnsavedChanges } from '../router/unsaved-changes.ts';
import { useDashboardLanguage } from '../runtime/use-dashboard-language.ts';
import { formField } from '../ui/form-field.ts';
import { skeleton } from '../ui/states.ts';
import { createFieldForm } from './field-form.ts';
import { controlIDs } from './field-type.ts';
import { specField } from './spec-field.ts';

/**
 * Options for `fieldInput`.
 */
export interface FieldInputOptions {
  /**
   * Whether the control is disabled. Reactive.
   */
  disabled?: () => boolean;

  /**
   * An outside message shown under the field while the field's own value is valid.
   * `''` or `undefined` shows none.
   */
  error?: () => string | undefined;

  /**
   * The field's size step, cascaded as `--ohne-size`.
   */
  size?: number;
}

/**
 * What a form read yields: the value, or the messages that block it, keyed by field path.
 */
export type FormReading<T> =
  | {
      /**
       * The value read.
       */
      value: T;

      /**
       * Absent on a successful read.
       */
      errors?: never;
    }
  | {
      /**
       * Absent on a failed read.
       */
      value?: never;

      /**
       * The messages that block the read, keyed by field path like `links[1].url`.
       */
      errors: Readonly<Record<string, string>>;
    };

/**
 * Options for `form`.
 */
export interface FormOptions<F extends FieldSpecs> {
  /**
   * The fields, by name, each declared with `field`.
   */
  fields: F;

  /**
   * How the rows are arranged: rows, cards, tabs, and rules, as a collection's `layout` arranges them.
   * Names are checked against `fields`; a field the layout does not place renders after it.
   * Omitted, every row stacks in field order.
   */
  layout?: FieldLayout<Extract<keyof F, string>, Text>;

  /**
   * The values the form starts from, like a `Resource`; `undefined` renders skeleton rows.
   * A field it holds no value for starts from its `default`.
   * Each later answer re-baselines the pristine rows and shows it.
   * A dirty row keeps your edit and its baseline until you save or revert the form.
   * Omitted, the form starts from the defaults at once.
   */
  data?: () => Partial<FormValue<F>> | undefined;

  /**
   * Whether the whole form is disabled. Reactive.
   */
  disabled?: () => boolean;

  /**
   * Whether unsaved changes ask before the page navigates away.
   *
   * @default
   * true
   */
  guard?: boolean;
}

/**
 * A page form over `field` specs, ready to bind to `useAction({ form })`.
 */
export interface Form<F extends FieldSpecs> {
  /**
   * The rendered form.
   */
  element: HTMLElement;

  /**
   * The value as far as it parses, a field mid-edit keeping its last parseable value. Reactive.
   */
  value(): Partial<FormValue<F>>;

  /**
   * Reads the whole value; a failure shows its messages and focuses the first.
   */
  read(): FormReading<FormValue<F>>;

  /**
   * Reads only the changed fields, for a `PATCH`; a failure shows and focuses as `read` does.
   */
  readPatch(): FormReading<Partial<FormValue<F>>>;

  /**
   * Shows messages on their fields, like a `422`'s, and focuses the first one placed.
   * Returns the first message no field takes, or `''` when every message placed.
   */
  setErrors(errors: Readonly<Record<string, string>>): string;

  /**
   * Whether any field differs from its baseline. Reactive.
   */
  dirty(): boolean;

  /**
   * Restores every field to its baseline, the latest `data` answer included.
   */
  revert(): void;

  /**
   * Merges `value` into the baseline, like the values just saved, so those fields read clean.
   */
  rebase(value: Partial<FormValue<F>>): void;

  /**
   * Disables the form while a call it fed is in flight.
   */
  setBusy(busy: boolean): void;
}

css`
  .ohne-form {
    min-inline-size: auto;
    margin: 0;
    padding: 0;
    border: 0;
  }
`;

let sequence = 0;

/**
 * One field edited into a ref: the `field` spec's control, label, and messages, as `formField` lays them out.
 * Each valid change writes `model`; an invalid one shows its message, and `model` keeps its last valid value.
 * An emptied nullable field writes `null`.
 * Writing `model` from outside shows the new value, unless it is the value the field just wrote.
 * The ref's owner owns the state, so the field never guards navigation.
 *
 * @example
 * ```ts
 * const recipient = ref('')
 *
 * fieldInput(recipient, field('text', { label: 'Recipient', max: 120 }))
 * ```
 */
export function fieldInput<K extends FieldTypeName, O>(
  model: Ref<NoInfer<FieldValue<K, O>>>,
  field: FieldSpec<K, O>,
  options: FieldInputOptions = {},
): HTMLElement {
  const name = `input-${++sequence}`;
  const described = specField(name, field, '');
  let written: unknown = untracked(() => model.value);
  const inner = createFieldForm(
    [described],
    { [name]: written },
    {
      mode: 'create',
      path: '',
      language: () => useDashboardLanguage().value,
      onInput() {
        const reading = inner.read();
        inner.setErrors(reading.errors ?? {});
        const value = (reading.value as Readonly<Record<string, unknown>> | undefined)?.[name];
        if (isUndefined(value)) return;
        written = value;
        model.value = value as FieldValue<K, O>;
      },
    },
  );
  effect(() => {
    const next = model.value;
    untracked(() => {
      if (deepEqual(next, written)) return;
      written = next;
      inner.rebase({ [name]: next });
      inner.revert();
    });
  });

  const control = inner.controlOf(name);
  const { label } = field.options as CommonFieldOptions;
  const own = (): string => control?.error() ?? '';
  const root = h(
    'fieldset',
    { class: 'ohne-form ohne-field', disabled: () => options.disabled?.() === true },
    isUndefined(control)
      ? inner.render()
      : formField(control.element, {
          label: isUndefined(control.marks) ? label : undefined,
          description: described.description ?? described.expandable?.text,
          required: described.required,
          error: () => own() || options.error?.() || '',
          size: options.size,
        }),
  );
  if (isUndefined(label) && isUndefined(control?.marks)) {
    // The control points at a form row's label, which an unlabeled input never renders.
    root.querySelector(`#${controlIDs(name).input}`)?.removeAttribute('aria-labelledby');
  }
  return root;
}

/**
 * A page form over `field` specs: typed values in, typed values out, the record editor's rows in between.
 * `read` yields `FormValue<F>`: every choice narrowed, a nullable field `| null`, a gated field optional.
 * Each control parses and checks its value with the server's own rules and messages.
 * A required field left empty reads as `validation.required`, exactly as the server answers it.
 * An ungated field with a `default` left empty reads as that default, the value the server would store.
 * Unsaved changes guard navigation for the page's lifetime, unless `guard` is `false`.
 * A repeated or unknown `layout` name throws when the form is built.
 *
 * @example
 * ```ts
 * const settings = form({
 *   fields: {
 *     siteName: field('text', { max: 80 }),
 *     theme: field('select', { choices: ['light', 'dark'], default: 'light' }),
 *   },
 *   layout: [{ row: ['siteName', 'theme'] }],
 *   data: useResource<Settings>('GET /settings'),
 * })
 *
 * useAction('PATCH /settings', { form: settings })
 * ```
 */
export function form<const F extends FieldSpecs>(options: FormOptions<F>): Form<F> {
  const names = Object.keys(options.fields);
  const problem = first(layoutProblems(options.layout, names, { isLabel: () => true }));
  if (!isUndefined(problem)) throw new Error([problem.title, ...problem.body].join('\n'));

  const fields = names.map((name) => specField(name, options.fields[name] as FieldSpec));
  const layout = isUndefined(options.layout)
    ? undefined
    : resolveLayoutNodes(options.layout, new Set(names));
  const owner = effectScope();
  onCleanup(() => owner.dispose());
  const live = ref<FieldForm | undefined>(undefined);
  const busy = ref(false);
  let baseline: Record<string, unknown> = {};

  const receive = (answer: Readonly<Record<string, unknown>>): void => {
    baseline = { ...answer };
    const current = live.value;
    if (isUndefined(current)) {
      live.value = owner.run(() =>
        createFieldForm(fields, baseline, {
          mode: 'create',
          path: '',
          idScope: `form-${++sequence}`,
          layout,
          language: () => useDashboardLanguage().value,
        }),
      );
      return;
    }
    for (const field of fields) {
      const control = current.controlOf(field.name);
      if (isUndefined(control) || control.dirty()) continue;
      const value = baseline[field.name];
      control.rebase(isUndefined(value) ? field.options?.default : value);
      control.revert();
    }
  };

  if (isUndefined(options.data)) receive({});
  else {
    const { data } = options;
    effect(() => {
      const answer = data();
      if (!isUndefined(answer)) untracked(() => receive(answer));
    });
  }

  let last: Record<string, unknown> = {};
  const value = computed(() => (last = live.value?.snapshot(last) ?? last));

  // A cleared defaulted field reads as its default, the value the server would store for it.
  const defaulted = (value: unknown, read: (name: string) => boolean): Record<string, unknown> => {
    const filled = { ...(value as Record<string, unknown>) };
    for (const { name, when, options: declared = {} } of fields) {
      const cleared = isUndefined(filled[name]) && isUndefined(when) && read(name);
      if (cleared && hasKey(declared, 'default')) filled[name] = declared.default;
    }
    return filled;
  };

  const failed = (
    current: FieldForm,
    errors: Readonly<Record<string, string>>,
  ): { errors: Readonly<Record<string, string>> } => {
    current.setErrors(errors);
    current.focusError();
    return { errors };
  };

  const element = h(
    'fieldset',
    {
      class: 'ohne-form',
      disabled: () => busy.value || options.disabled?.() === true,
      'aria-busy': () => (isUndefined(live.value) ? 'true' : undefined),
    },
    () => {
      const current = live.value;
      if (!isUndefined(current)) return current.render();
      return names.map(() =>
        formField([skeleton({ width: '6rem' }), skeleton({ height: 'calc(2em + 0.25rem)' })]),
      );
    },
  );

  const handle: Form<F> = {
    element,
    value: () => value.value as Partial<FormValue<F>>,
    read() {
      const current = untracked(() => live.value);
      if (isUndefined(current)) return { errors: {} };
      const reading = current.read();
      if (!isUndefined(reading.errors)) return failed(current, reading.errors);
      const controlled = (name: string): boolean => !isUndefined(current.controlOf(name));
      return { value: defaulted(reading.value, controlled) as FormValue<F> };
    },
    readPatch() {
      const current = untracked(() => live.value);
      if (isUndefined(current)) return { errors: {} };
      const reading = current.readPatch();
      if (!isUndefined(reading.errors)) return failed(current, reading.errors);
      const dirty = (name: string): boolean => current.controlOf(name)?.dirty() === true;
      return { value: defaulted(reading.value, dirty) as Partial<FormValue<F>> };
    },
    setErrors(errors) {
      const current = untracked(() => live.value);
      if (isUndefined(current)) return first(Object.values(errors)) ?? '';
      const unplaced = current.setErrors(errors);
      current.focusError();
      return unplaced;
    },
    dirty: () => live.value?.dirty() ?? false,
    revert() {
      const current = untracked(() => live.value);
      current?.rebase(baseline);
      current?.revert();
    },
    rebase(saved) {
      baseline = { ...baseline, ...saved };
      untracked(() => live.value)?.rebase(baseline);
    },
    setBusy(next) {
      busy.value = next;
    },
  };
  if (options.guard !== false) useUnsavedChanges(handle.dirty);
  return handle;
}

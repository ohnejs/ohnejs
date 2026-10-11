import {
  button,
  confirmLeave,
  createFieldForm,
  css,
  type DashboardCollection,
  type DashboardField,
  fallbackLabel,
  type FieldForm,
  fieldMessage,
  h,
  labelOf,
  navigate,
  popup,
  type Popup,
  type RouteContext,
  toast,
  translateMessage,
  useAction,
  useDashboardLanguage,
  useHotkeys,
  useRoute,
  useT,
  when,
} from 'ohnejs/dashboard';
import {
  effect,
  isDotPathInside,
  isNull,
  isPlainObject,
  isString,
  isUndefined,
  onCleanup,
  ref,
  type SearchParamValue,
  stringifySearchParams,
  toArray,
  untracked,
} from 'ohnejs/utils';

import { activeContentLocale } from './content-language-switcher.ts';
import { historyButtons } from './history-buttons.ts';
import { History } from './history.ts';

/**
 * Options for `editTableFieldPopup`.
 */
export interface EditTableFieldPopupOptions {
  /**
   * The collection the edited record belongs to.
   */
  collection: DashboardCollection;

  /**
   * The single field the popup edits.
   */
  field: DashboardField;

  /**
   * The edited record's `UUID`.
   */
  uuid: string;

  /**
   * The field's current value, seeding the control.
   */
  value: unknown;

  /**
   * Renders the field read-only, without the footer, the hotkeys, and the autofocus.
   *
   * @default
   * false
   */
  disabled?: boolean;

  /**
   * Whether the popup expands to full height with a sticky header and footer.
   * `'auto'` keeps the sticky chrome while the popup stays content-sized.
   *
   * @default
   * false
   */
  fullHeight?: boolean | 'auto';

  /**
   * Called when the popup asks to close, with its animated close function.
   * The caller awaits it and then disposes the region that created the popup.
   */
  onClose(close: () => Promise<void>): void;

  /**
   * Called with the answered record after a successful save, so the host can replace its row.
   */
  onUpdated?(record: Record<string, unknown>): void;
}

css`
  .o-edit-field-title {
    font-weight: 500;
  }

  .o-edit-field-fields {
    border: 0;
    margin: 0;
    padding: 0;
    min-inline-size: auto;
  }

  .o-edit-field-fields > .ohne-field-message {
    margin-top: 0.5em;
  }
`;

/**
 * Reads the `edit` query parameter, reactively.
 * It carries `[field, uuid]` while a cell edit is deep-linked, and is empty otherwise.
 */
export function editQueryParam(): string[] {
  return toArray<SearchParamValue | undefined>(useRoute()?.query.edit).filter(isString);
}

/**
 * Writes the `edit` query parameter, pushing history, or removes it when `value` is `null`.
 * The step keeps the page, so the popup opens over the live table and back closes it.
 * A write is a no-op unless `route` is still the active route, so a teardown never lands on the next page.
 * Capture `route` when the binding is created; a query-only step keeps it, a page swap replaces it.
 */
export function setEditQueryParam(
  value: string[] | null,
  route: RouteContext | null = untracked(useRoute),
): void {
  if (isNull(route) || untracked(useRoute) !== route) return;
  const query = stringifySearchParams({
    ...untracked(() => route.query),
    edit: isNull(value) ? undefined : value,
  });
  void navigate(location.pathname + (query === '' ? '' : `?${query}`) + location.hash);
}

/**
 * The single-field edit popup.
 *
 * It hosts one field's control through `createFieldForm`, with undo and redo over a `History`.
 * Cmd/Ctrl+S saves, and closing is dirty-guarded through the leave prompt.
 * The save patches only this field; a `422` routes onto the control and raises the error count toast.
 * A message for a field the popup does not show, like a translation's required slug, renders below it.
 * A save whose answer lacks the field toasts it as not saved: the update scope's `select` dropped it.
 * A vanished record toasts and closes.
 * The popup follows the `edit` query parameter: when it disappears, the popup closes.
 * Unmounting removes it, so the deep link and the popup stay in step.
 * Create it inside a reactive region; dispose the region after `onClose`'s close resolves.
 */
export function editTableFieldPopup(options: EditTableFieldPopupOptions): Popup {
  const t = useT();
  const { collection, field, uuid } = options;
  const disabled = options.disabled ?? false;
  const unplaced = ref('');

  const buildForm = (initial: Record<string, unknown>): FieldForm =>
    createFieldForm([field], initial, {
      mode: 'edit',
      path: '',
      renderUUID: true,
      readOnly: disabled,
      readOnlyRows: true,
      language: () => useDashboardLanguage().value,
      onInput: () => {
        const state = currentState();
        if (!isUndefined(state)) void history.pushDebounced(state);
      },
    });

  const seed: Record<string, unknown> = { [field.name]: options.value };
  const history = new History().push(seed);
  const form = ref<FieldForm>(buildForm(seed));
  onCleanup(() => form.value.dispose());

  const currentState = (): Record<string, unknown> =>
    form.value.snapshot(history.getCurrentState());

  const restore = (state: Record<string, unknown> | undefined): void => {
    if (isUndefined(state)) return;
    form.value.dispose();
    form.value = buildForm(state);
  };

  const write = useAction<Record<string, unknown>>('PATCH /collections/[collection]/[uuid]', {
    params: { collection: collection.segment, uuid },
    onDone: (saved) => {
      // A scoped answer omits a field outside its `select`; the seed still holds its value.
      const record = { ...seed, ...saved };
      const state = { [field.name]: record[field.name] };
      form.value.rebase(record);
      history.push(state).setOriginalState(state);
      toast(t('dashboard.saved'), { type: 'success', description: translateMessage(field.label) });
      options.onUpdated?.(saved);
      options.onClose(handle.close);
    },
    onError: (error) => {
      if (error.status === 404) {
        toast(t('dashboard.record.gone'), { type: 'error' });
        options.onClose(handle.close);
        return;
      }
      const errors = isPlainObject(error.data) ? error.data.errors : undefined;
      if (error.status !== 422 || !isPlainObject<Readonly<Record<string, string>>>(errors)) {
        toast(error.message, { type: 'error' });
        return;
      }
      const leftover = form.value.setErrors(errors);
      unplaced.value = leftover === '' ? '' : namedMessage(collection, errors, leftover);
      form.value.focusError();
      toast(t('dashboard.foundErrors', { count: Object.keys(errors).length }), {
        type: 'error',
      });
    },
  });

  const save = async (): Promise<void> => {
    if (write.busy() || disabled) return;
    const reading = form.value.read();
    if (!isUndefined(reading.errors)) {
      form.value.focusError();
      return;
    }
    unplaced.value = '';
    await write.run({
      body: reading.value ?? {},
      query: collection.translatable ? { locale: activeContentLocale() } : undefined,
    });
  };

  const guardedClose = async (): Promise<void> => {
    if (!history.isDirty.value || (await confirmLeave())) {
      options.onClose(handle.close);
    }
  };

  const closeButton = button(() => t('dashboard.close'), {
    icon: 'x',
    iconOnly: true,
    size: -2,
    variant: 'ghost',
    class: 'ohne-ml-auto',
    onClick: () => void guardedClose(),
  });

  // `save` guards re-entry itself, so Save carries no disabled state.
  // The class stays static: a reactive one would re-apply and overwrite the variant toggles below.
  const saveButton = button(() => t('dashboard.save'), {
    variant: 'outline',
    class: 'ohne-ml-auto',
    onClick: () => void save(),
  });
  effect(() => {
    const dirty = history.isDirty.value;
    saveButton.classList.toggle('ohne-button-primary', dirty);
    saveButton.classList.toggle('ohne-button-outline', !dirty);
  });

  const hotkeys = useHotkeys({
    allowInOverlays: true,
    allowWhileTyping: ['undo', 'redo'],
    target: () => handle.root,
    listen: false,
  });

  const handle = popup(
    h(
      'fieldset',
      { class: 'o-edit-field-fields', disabled: () => write.busy() },
      () => form.value.render(),
      when(
        () => unplaced.value !== '',
        () => fieldMessage(() => unplaced.value, { error: () => true }),
      ),
    ),
    {
      size: -1,
      width: '40rem',
      fullHeight: options.fullHeight ?? false,
      header: h(
        'span',
        { class: 'o-edit-field-title ohne-row' },
        h('span', { class: 'ohne-truncate' }, collection.label),
        h(
          'span',
          { class: 'ohne-muted ohne-truncate' },
          () => `(${labelOf(collection.name, uuid, activeContentLocale()) ?? fallbackLabel(uuid)})`,
        ),
        closeButton,
      ),
      footer: disabled
        ? undefined
        : h(
            'div',
            { class: 'ohne-justify-between' },
            historyButtons(history, restore, hotkeys),
            saveButton,
          ),
      onClose: () => void guardedClose(),
    },
  );

  if (!disabled) {
    setTimeout(() => {
      hotkeys.isListening.value = true;
      hotkeys.listen('save', (event) => {
        event.preventDefault();
        const active = document.activeElement;
        if (active instanceof HTMLElement) active.blur();
        setTimeout(() => void save());
      });
    });
    setTimeout(() =>
      setTimeout(() =>
        setTimeout(() => {
          setTimeout(
            () =>
              handle.root
                .querySelector<HTMLElement>('input:not([type="hidden"]), textarea, [tabindex="0"]')
                ?.focus(),
            overlayTransitionDuration(),
          );
        }),
      ),
    );
  }

  effect(() => {
    if (editQueryParam().length === 0) {
      setTimeout(() => {
        history.clear();
        options.onClose(handle.close);
      });
    }
  });

  const route = untracked(useRoute);
  onCleanup(() => setEditQueryParam(null, route));

  return handle;
}

/**
 * Reads the overlay transition duration off the body, in milliseconds; `300` when unreadable.
 */
function overlayTransitionDuration(): number {
  const raw = getComputedStyle(document.body)
    .getPropertyValue('--ohne-overlay-transition-duration')
    .trim();
  if (raw.endsWith('ms')) return parseInt(raw, 10) || 300;
  if (raw.endsWith('s')) return parseFloat(raw) * 1000 || 300;
  return 300;
}

/**
 * `message` prefixed with the label of the field it belongs to, so it never reads as the shown field's.
 */
function namedMessage(
  collection: DashboardCollection,
  errors: Readonly<Record<string, string>>,
  message: string,
): string {
  const path = Object.keys(errors).find((key) => errors[key] === message);
  const owner = isUndefined(path)
    ? undefined
    : collection.fields.find((field) => isDotPathInside(path, field.name));
  return isUndefined(owner) ? message : `${translateMessage(owner.label)}: ${message}`;
}

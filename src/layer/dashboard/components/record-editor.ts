import {
  api,
  attachTooltip,
  button,
  type Child,
  container,
  createFieldForm,
  css,
  type DashboardCollection,
  dashboardMeta,
  dropdown,
  dropdownItem,
  fallbackLabel,
  type FieldForm,
  h,
  icon,
  joinLabel,
  knownLabel,
  navigate,
  openDialog,
  overlayCount,
  queueToast,
  seedLabel,
  setNavigationGuard,
  toast,
  useDashboardLanguage,
  useHotkeys,
  useT,
  when,
} from 'ohne/dashboard';
import {
  deepEqual,
  effect,
  hasKey,
  isEmpty,
  isNull,
  isString,
  isUndefined,
  onCleanup,
  ref,
  sleep,
  stringifySearchParams,
  untracked,
} from 'ohne/utils';

import { activeContentLocale, contentLocale } from './content-language-switcher.ts';
import { historyButtons } from './history-buttons.ts';
import { historyScrollState } from './history-scroll-state.ts';
import { History, unsavedChanges } from './history.ts';
import { translationsPopup } from './translations-popup.ts';

/**
 * One record row, as the collections API answers it.
 */
type RecordRow = Record<string, unknown>;

css`
  .o-record-editor {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .o-record-editor-header {
    padding: calc(0.75rem + 1px) 0.75rem 0.75rem;
    border-bottom-width: 1px;
    font-size: 0.875rem;
    font-weight: 500;
  }

  .o-record-editor-header .ohne-button {
    margin-right: 0.25rem;
    margin-left: 0.25rem;
  }

  .o-record-editor-header .ohne-button:first-child {
    margin-left: 0;
  }

  .o-record-editor-header .ohne-button:last-child {
    margin-right: 0;
  }

  .o-record-editor-main {
    container-type: inline-size;
    contain: layout;
    padding: 0.75rem;
  }

  .o-record-editor-footer {
    border-top-width: 1px;
    padding: 0.75rem;
  }

  .o-record-editor-fields {
    border: 0;
    margin: 0;
    padding: 0;
    min-inline-size: auto;
  }

  .o-record-editor-failed {
    display: grid;
    justify-items: center;
    align-content: center;
    gap: 0.75rem;
    padding: 3rem 0;
    color: hsl(var(--ohne-muted-foreground));
  }

  @media (max-width: 1024px) {
    .o-record-editor-header .ohne-button {
      --ohne-size: -2;
    }
  }
`;

/**
 * The record surface.
 *
 * Create and edit share this one page; `uuid` absent means create.
 * The scrollable page column holds the header row and the field rows.
 * The sticky footer holds the undo and redo pair, Save with the dirty primary toggle, and the actions menu.
 * Every edit debounce-pushes onto a `History`; undo and redo rebuild the form from the restored state.
 * `historyScrollState` pins the scroll across the re-render.
 * Leaving dirty edits routes through the `unsavedChanges` prompt, in-app and on tab close.
 * Cmd/Ctrl+S saves while no overlay is open.
 * A `422` routes onto the rows it names and raises the error count toast.
 * A vanished record redirects to the collection with a toast.
 * Create posts the touched fields so server defaults apply, then navigates to the new record.
 */
export function recordEditor(collection: DashboardCollection, uuid: string | undefined): Child {
  const t = useT();
  const create = isUndefined(uuid);
  const id = uuid ?? '';
  const listPath = `/collections/${collection.segment}`;
  const canCreate = collection.operations.create?.allowed === true;
  const canUpdate = collection.operations.update?.allowed === true;
  const canDelete = collection.operations.delete?.allowed === true;
  const canTranslate =
    collection.translatable && (untracked(dashboardMeta)?.locales.length ?? 0) > 1;
  const readOnly = !create && !canUpdate;
  const showFooter = create || canCreate || canUpdate || canDelete;

  const formFields = collection.fields.filter(
    (field) => field.name !== 'UUID' && field.name !== '_updatedAt',
  );

  const history = new History({
    omit: collection.fields
      .filter((field) => !field.writable || field.immutable)
      .map((field) => field.name),
  });

  const buildForm = (initial: RecordRow | undefined): FieldForm =>
    createFieldForm(formFields, initial, {
      mode: create ? 'create' : 'edit',
      path: '',
      readOnlyRows: true,
      readOnly,
      language: () => activeContentLocale() ?? useDashboardLanguage().value,
      onInput: () => {
        const state = currentState();
        if (!isUndefined(state)) void history.pushDebounced(state);
      },
    });

  // The form lives in its own ref so a save or a restore rebuilds only the fieldset, not the body.
  const state = ref<'loading' | 'ready' | 'failed'>(create ? 'ready' : 'loading');
  const form = ref<FieldForm | undefined>(create ? buildForm(undefined) : undefined);
  const busy = ref(false);
  onCleanup(() => form.value?.dispose());

  const currentState = (): RecordRow | undefined => {
    const reading = form.value?.read();
    if (isUndefined(reading) || !isUndefined(reading.errors)) return undefined;
    return (reading.value ?? {}) as RecordRow;
  };

  const restore = (restored: RecordRow): void => {
    form.value?.dispose();
    form.value = buildForm(restored);
  };

  const redirectGone = (): void => {
    queueToast(t('dashboard.redirected'), {
      type: 'error',
      description: t('dashboard.pageNotFound'),
      showAfterRouteChange: true,
    });
    navigate(listPath);
  };

  const load = async (): Promise<void> => {
    state.value = 'loading';
    const row = await readRecord(
      collection.segment,
      id,
      collection.translatable ? untracked(activeContentLocale) : undefined,
    );
    if (isUndefined(row)) {
      state.value = 'failed';
      return;
    }
    if (isNull(row)) {
      redirectGone();
      return;
    }
    seedRecordLabel(collection, row);
    form.value?.dispose();
    form.value = buildForm(row);
    history.push(currentState() ?? {});
    state.value = 'ready';
    settleHash();
  };
  if (create) {
    // Untracked: a tracked seed read would subscribe the whole page region to the first keystroke.
    history.push(untracked(currentState) ?? {});
    settleHash();
  } else {
    void load();
    if (collection.translatable) {
      let applied = untracked(activeContentLocale);
      const switchLocale = async (next: string | undefined): Promise<void> => {
        const allowed =
          !busy.value && (!history.isDirty.value || ((await unsavedChanges.prompt?.()) ?? true));
        if (!allowed) {
          contentLocale.value = applied;
          return;
        }
        // Clearing reseeds the history on the newly read locale, so Save starts clean against it.
        applied = next;
        history.clear();
        // A confirmed prompt dropped the registration; the editor lives on, so the tab-close guard re-arms.
        unsavedChanges.history = history;
        void load();
      };
      effect(() => {
        const next = activeContentLocale();
        if (next !== applied) untracked(() => void switchLocale(next));
      });
    }
  }

  // The in-app leg of the leave guard: `unsavedChanges` owns the dialog and the tab-close leg.
  setNavigationGuard((target) => {
    if (!history.isDirty.value || isUndefined(unsavedChanges.prompt)) {
      unsavedChanges.history = null;
      return true;
    }
    void unsavedChanges.prompt().then((leave) => {
      if (leave) {
        setNavigationGuard(null);
        navigate(target);
      }
    });
    return false;
  });
  onCleanup(() => setNavigationGuard(null));

  const save = async (): Promise<void> => {
    const live = form.value;
    if (isUndefined(live) || busy.value || readOnly) return;
    const reading = live.read();
    if (!isUndefined(reading.errors)) {
      live.focusError();
      return;
    }
    const full = (reading.value ?? {}) as RecordRow;
    const body = create ? full : changedSince(full, history.getOriginalState() ?? {});
    if (!create && isEmpty(body)) return;
    const focused = document.activeElement;
    busy.value = true;
    const outcome = await write(
      collection.segment,
      uuid,
      body,
      collection.translatable ? activeContentLocale() : undefined,
    );
    busy.value = false;
    // The saving fieldset blurs whatever was focused; the element survives the save, so restore.
    if (focused instanceof HTMLElement && focused.isConnected) focused.focus();
    if (outcome.kind === 'saved') {
      live.rebase(outcome.record);
      const settled = currentState();
      if (!isUndefined(settled)) history.push(settled).setOriginalState(settled);
      seedRecordLabel(collection, outcome.record);
      if (create) {
        queueToast(t('dashboard.created'), { type: 'success', showAfterRouteChange: true });
        if (isString(outcome.record.UUID)) navigate(`${listPath}/${outcome.record.UUID}`);
      } else {
        queueToast(t('dashboard.saved'), { type: 'success' });
      }
      return;
    }
    if (outcome.kind === 'invalid') {
      live.setErrors(outcome.errors);
      live.focusError();
      toast(t('dashboard.foundErrors', { count: Object.keys(outcome.errors).length }), {
        type: 'error',
      });
      return;
    }
    if (outcome.kind === 'gone') {
      history.clear();
      redirectGone();
      return;
    }
    toast(t(outcome.kind === 'unreachable' ? 'dashboard.unreachable' : 'dashboard.writeFailed'), {
      type: 'error',
    });
  };

  const removeRecord = async (): Promise<void> => {
    if (busy.value) return;
    const action = await openDialog({
      content: t('dashboard.record.confirmDelete'),
      actions: [
        { name: 'cancel', label: t('dashboard.cancel') },
        { name: 'delete', label: t('dashboard.delete'), variant: 'destructive' },
      ],
    });
    if (action !== 'delete') return;
    busy.value = true;
    const gone = await deleteRecord(collection.segment, id);
    busy.value = false;
    if (!gone) return;
    setTimeout(() => {
      history.clear();
      queueToast(t('dashboard.record.deleted'), { type: 'success', showAfterRouteChange: true });
      navigate(listPath);
    }, overlayTransitionDuration());
  };

  const { listen } = useHotkeys();
  listen('save', (event) => {
    if (overlayCount() > 0) return;
    event.preventDefault();
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
    setTimeout(() => void save());
  });

  const backButton = button(icon('folder'), { variant: 'outline', href: listPath });
  onCleanup(
    attachTooltip(backButton, () =>
      t('dashboard.record.collectionOverview', { collection: collection.label }),
    ),
  );

  const headerEl = h(
    'div',
    { class: 'o-record-editor-header' },
    h(
      'div',
      { class: 'ohne-row' },
      backButton,
      h('span', { class: 'ohne-truncate' }, collection.label),
      create
        ? h('span', { class: 'ohne-shrink-0 ohne-muted' }, () => `(${t('dashboard.new')})`)
        : h(
            'span',
            { class: 'ohne-truncate ohne-muted' },
            () => `(${knownLabel(collection.name, id) ?? fallbackLabel(id)})`,
          ),
    ),
  );

  const mainEl = h('div', { class: 'o-record-editor-main' }, () => {
    if (state.value === 'failed') {
      return h(
        'div',
        { class: 'o-record-editor-failed' },
        () => t('dashboard.unreachable'),
        button(() => t('dashboard.retry'), { variant: 'outline', onClick: () => void load() }),
      );
    }
    if (state.value !== 'ready') return null;
    return h('fieldset', { class: 'o-record-editor-fields', disabled: () => busy.value }, () =>
      form.value?.render(),
    );
  });

  const containerEl = container([headerEl, mainEl]);
  containerEl.classList.add('ohne-flex-1');

  const scrollY = ref(0);
  containerEl.addEventListener(
    'scroll',
    () => {
      scrollY.value = containerEl.scrollTop;
    },
    { passive: true },
  );
  historyScrollState({
    y: () => scrollY.value,
    setY: (value) => {
      containerEl.scrollTop = value;
      scrollY.value = value;
    },
  });

  // Save takes no disabled state: `save` guards re-entry, and a static variant keeps the toggles below.
  const saveButton = button(
    [
      h('span', null, () => t(create ? 'dashboard.create' : 'dashboard.save')),
      icon('device-floppy'),
    ],
    { variant: 'outline', onClick: () => void save() },
  );
  effect(() => {
    const dirty = history.isDirty.value;
    saveButton.classList.toggle('ohne-button-primary', dirty);
    saveButton.classList.toggle('ohne-button-outline', !dirty);
  });

  const footerEl = showFooter
    ? h(
        'div',
        { class: 'o-record-editor-footer' },
        h(
          'div',
          { class: 'ohne-justify-between ohne-w-full' },
          when(
            () => (create || canUpdate) && !isUndefined(form.value),
            () => historyButtons(history, restore),
          ),
          h(
            'div',
            { class: 'ohne-row ohne-ml-auto' },
            create || canUpdate ? saveButton : null,
            create ? null : recordMenu(),
          ),
        ),
      )
    : null;

  /**
   * The record actions menu of the edit page: the trigger turns primary while the dropdown is open.
   * New links to the create page, Translate opens the translations popup, Delete confirms first.
   */
  function recordMenu(): Child {
    if (!canCreate && !canDelete && !canTranslate) return null;
    const open = ref(false);
    const translationsOpen = ref(false);
    const close = (): void => {
      open.value = false;
    };
    const trigger = button(icon('dots-vertical'), {
      variant: 'outline',
      onClick: () => {
        open.value = true;
      },
    });
    effect(() => {
      trigger.title = t('dashboard.record.moreActions');
      trigger.classList.toggle('ohne-button-primary', open.value);
      trigger.classList.toggle('ohne-button-outline', !open.value);
    });
    return h(
      'div',
      { class: 'ohne-flex' },
      trigger,
      when(
        () => open.value,
        () => {
          const items: Child[] = [];
          if (canCreate) {
            const item = dropdownItem([icon('note'), h('span', null, () => t('dashboard.new'))], {
              href: `${listPath}/new`,
              onClick: close,
            });
            effect(() => {
              item.title = t('dashboard.new');
            });
            items.push(item);
          }
          if (canCreate && (canTranslate || canDelete)) items.push(h('hr'));
          if (canTranslate) {
            const item = dropdownItem(
              [icon('language'), h('span', null, () => t('dashboard.translations.translate'))],
              {
                onClick: () => {
                  close();
                  translationsOpen.value = true;
                },
              },
            );
            effect(() => {
              item.title = t('dashboard.translations.translate');
            });
            items.push(item);
          }
          if (canDelete) {
            const item = dropdownItem(
              [icon('trash-x'), h('span', null, () => t('dashboard.delete'))],
              {
                destructive: true,
                onClick: () => {
                  close();
                  void removeRecord();
                },
              },
            );
            effect(() => {
              item.title = t('dashboard.delete');
            });
            items.push(item);
          }
          return dropdown(items, { reference: trigger, onClose: close }).root;
        },
      ),
      when(
        () => translationsOpen.value,
        () => {
          translationsPopup({
            collection,
            uuid: id,
            onClose: (closePopup) =>
              void closePopup().then(() => {
                translationsOpen.value = false;
              }),
          });
          return null;
        },
      ),
    );
  }

  return h('div', { class: 'o-record-editor' }, containerEl, footerEl);
}

/**
 * Reads the record by `UUID` through the body-query endpoint, at `locale` when one is given.
 * Resolves the row, `null` when the collection has no such record, `undefined` on failure.
 */
async function readRecord(
  segment: string,
  uuid: string,
  locale?: string,
): Promise<RecordRow | null | undefined> {
  try {
    const response = await api(`POST /collections/${segment}/query`, {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        where: { UUID: uuid },
        perPage: 1,
        ...(isUndefined(locale) ? {} : { locale }),
      }),
    });
    if (!response.ok) return undefined;
    const page = (await response.json()) as { records?: RecordRow[] };
    return page.records?.[0] ?? null;
  } catch {
    return undefined;
  }
}

type WriteOutcome =
  | { kind: 'saved'; record: RecordRow }
  | { kind: 'invalid'; errors: Readonly<Record<string, string>> }
  | { kind: 'gone' }
  | { kind: 'unreachable' }
  | { kind: 'writeFailed' };

/**
 * Sends the save, retrying once on a busy `503`: a create `POST`, or a partial `PATCH` by `UUID`.
 * A given `locale` rides the URL, so a translatable collection writes that locale's values.
 */
async function write(
  segment: string,
  uuid: string | undefined,
  body: RecordRow,
  locale?: string,
): Promise<WriteOutcome> {
  const suffix = isUndefined(locale) ? '' : `?${stringifySearchParams({ locale })}`;
  const send = (): Promise<Response> =>
    api(
      isUndefined(uuid)
        ? `POST /collections/${segment}${suffix}`
        : `PATCH /collections/${segment}/${uuid}${suffix}`,
      {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
  try {
    let response = await send();
    if (response.status === 503) {
      await sleep(1000);
      response = await send();
    }
    if (response.ok) return { kind: 'saved', record: (await response.json()) as RecordRow };
    if (response.status === 422) {
      const answer = (await response.json()) as { data?: { errors?: Record<string, string> } };
      const errors = Object.create(null) as Record<string, string>;
      Object.assign(errors, answer.data?.errors ?? {});
      return { kind: 'invalid', errors };
    }
    if (response.status === 404) return { kind: 'gone' };
    return { kind: 'writeFailed' };
  } catch {
    return { kind: 'unreachable' };
  }
}

/**
 * Deletes the record, retrying once on a busy `503`; answers whether the delete landed.
 */
async function deleteRecord(segment: string, uuid: string): Promise<boolean> {
  const send = (): Promise<Response> => api(`DELETE /collections/${segment}/${uuid}`);
  try {
    let response = await send();
    if (response.status === 503) {
      await sleep(1000);
      response = await send();
    }
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * The fields of `full` whose value differs from `original`, the edit save's `PATCH` body.
 */
function changedSince(full: RecordRow, original: RecordRow): RecordRow {
  const changed: RecordRow = {};
  for (const [key, value] of Object.entries(full)) {
    if (!deepEqual(value, original[key])) changed[key] = value;
  }
  return changed;
}

/**
 * Seeds the label cache with the record's own label, so the header, the title, and relation cells read it.
 * A row carrying every label field and still joining to nothing names the record by `fallbackLabel`.
 * A scoped answer that omits one seeds nothing: its empty join says nothing about the record.
 */
function seedRecordLabel(collection: DashboardCollection, row: RecordRow): void {
  const uuid = row.UUID;
  if (!isString(uuid)) return;
  const label = joinLabel(row, collection);
  if (label !== '') seedLabel(collection.name, uuid, label);
  else if (collection.labelFields.every((name) => hasKey(row, name))) {
    seedLabel(collection.name, uuid, fallbackLabel(uuid));
  }
}

/**
 * Scrolls a `#field-<name>` hash target into view and focuses its control once the form stands.
 */
function settleHash(): void {
  const hash = location.hash.slice(1);
  if (!hash.startsWith('field-')) return;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      document.getElementById(hash)?.scrollIntoView({ block: 'center' });
      const input = document.getElementById(`${hash}-input`);
      if (input instanceof HTMLElement) input.focus();
    }),
  );
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

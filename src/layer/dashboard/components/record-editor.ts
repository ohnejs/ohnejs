import {
  api,
  button,
  type Child,
  createFieldForm,
  css,
  type DashboardCollection,
  type DashboardField,
  type FieldForm,
  h,
  icon,
  navigate,
  seedLabel,
  setNavigationGuard,
  toast,
  useDashboardLanguage,
  useT,
  when,
} from 'ohne/dashboard';
import {
  isEmpty,
  isNull,
  isNumber,
  isString,
  isUndefined,
  onCleanup,
  ref,
  sleep,
} from 'ohne/utils';

/**
 * One record row, as the collections API answers it.
 */
type RecordRow = Record<string, unknown>;

const dateFormats = new Map<string, Intl.DateTimeFormat>();

css`
  .record-editor {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  .record-bar {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--s3);
    height: var(--bar);
    padding: 0 var(--s4);
    background: var(--surface);
    border-bottom: 1px solid var(--line);
  }

  .record-crumb {
    color: var(--faint);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .record-crumb a:hover {
    color: var(--dim);
  }

  .record-crumb b {
    color: var(--text);
    font-weight: 500;
  }

  .record-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-family: var(--mono);
    font-size: var(--fs-micro);
    color: var(--dim);
    background: var(--raised);
    border: 1px solid var(--line);
    border-radius: 3px;
    padding: 2px 6px;
    white-space: nowrap;
  }

  button.record-chip {
    cursor: pointer;
  }

  button.record-chip:hover {
    border-color: var(--line-strong);
    color: var(--text);
  }

  .record-chip .ohne-icon {
    width: 11px;
    height: 11px;
  }

  .record-actions {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: var(--s2);
  }

  .record-guard {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: var(--s2);
  }

  .record-guard-note {
    color: var(--warn);
    font-size: var(--fs-small);
  }

  .record-save-keys {
    margin-left: 5px;
    opacity: 0.6;
    font-size: var(--fs-micro);
  }

  .record-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }

  .record-column {
    max-width: 640px;
    padding: var(--s5) var(--s6) 64px;
  }

  .record-orphan {
    margin-bottom: var(--s4);
    font-size: var(--fs-small);
    color: var(--danger);
  }

  .record-fields {
    border: 0;
    margin: 0;
    padding: 0;
    min-inline-size: auto;
  }

  .record-missing {
    height: 100%;
    display: grid;
    place-items: center;
    align-content: center;
    gap: var(--s3);
    color: var(--faint);
  }

  .record-skeleton {
    max-width: 640px;
    padding: var(--s5) var(--s6);
  }

  .record-skeleton i {
    display: block;
    height: 6px;
    border-radius: 3px;
    background: var(--raised);
    margin-bottom: var(--s5);
  }
`;

/**
 * The record surface: one routed form where a record is created, read, edited, and deleted.
 *
 * Create and edit are the same form; `uuid` absent means create.
 * There is exactly one Save: create posts the touched fields, edit patches only the dirty ones.
 * Composites serialize into that same write, so no nested surface carries its own button.
 * A `422` routes onto the rows it names; what routes nowhere lands on the top failure line.
 * Leaving with unsaved changes swaps the bar for a guard strip instead of losing the edits.
 */
export function recordEditor(collection: DashboardCollection, uuid: string | undefined): Child {
  const t = useT();
  const create = isUndefined(uuid);
  const id = uuid ?? '';
  const canUpdate = collection.operations.update?.allowed === true;
  const readOnly = !create && !canUpdate;
  const listPath = `/collections/${collection.segment}`;
  const formID = `record-form-${collection.segment}`;

  const formFields = collection.fields.filter(
    (field) => field.name !== 'UUID' && field.name !== '_updatedAt',
  );
  const buildForm = (initial: RecordRow | undefined): FieldForm =>
    createFieldForm(formFields, initial, {
      mode: create ? 'create' : 'edit',
      path: '',
      readOnlyRows: true,
      readOnly,
      language: () => useDashboardLanguage().value,
      onInput: () => {
        orphan.value = '';
      },
    });

  // The body region branches on `state` alone; the record's data lives outside the reactive
  // graph, so a successful save never rebuilds the form around the user's focus.
  const state = ref<'loading' | 'ready' | 'missing' | 'failed'>(create ? 'ready' : 'loading');
  const heading = ref('');
  const updatedAt = ref<number | undefined>(undefined);
  const form = ref<FieldForm | undefined>(create ? buildForm(undefined) : undefined);
  const busy = ref(false);
  const orphan = ref('');
  const armed = ref(false);
  const pending = ref<string | null>(null);
  let armTimer: ReturnType<typeof setTimeout> | undefined;

  const dirty = (): boolean => form.value?.dirty() === true;

  const settle = (row: RecordRow): void => {
    heading.value = titleOf(collection, row);
    const at = row['_updatedAt'];
    updatedAt.value = isNumber(at) ? at : updatedAt.value;
  };

  const load = async (): Promise<void> => {
    if (create) return;
    state.value = 'loading';
    const row = await readRecord(collection.segment, id);
    if (isUndefined(row)) {
      state.value = 'failed';
      return;
    }
    if (isNull(row)) {
      state.value = 'missing';
      return;
    }
    form.value?.dispose();
    form.value = buildForm(row);
    settle(row);
    state.value = 'ready';
    settleHash();
  };
  void load();
  if (create) settleHash();
  onCleanup(() => form.value?.dispose());

  setNavigationGuard((target) => {
    if (!dirty()) return true;
    pending.value = target;
    return false;
  });
  onCleanup(() => setNavigationGuard(null));

  const onBeforeUnload = (event: BeforeUnloadEvent): void => {
    if (dirty()) event.preventDefault();
  };
  window.addEventListener('beforeunload', onBeforeUnload);
  onCleanup(() => window.removeEventListener('beforeunload', onBeforeUnload));

  const onKeydown = (event: KeyboardEvent): void => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      if (dirty() && !busy.value) void save();
    }
  };
  document.addEventListener('keydown', onKeydown, { capture: true });
  onCleanup(() => document.removeEventListener('keydown', onKeydown, { capture: true }));

  const resume = (): void => {
    const target = pending.value;
    pending.value = null;
    if (!isNull(target)) navigate(target);
  };

  const save = async (): Promise<void> => {
    const live = form.value;
    if (isUndefined(live) || busy.value || readOnly) return;
    orphan.value = '';
    const reading = create ? live.read() : live.readPatch();
    if (!isUndefined(reading.errors)) {
      live.focusError();
      return;
    }
    const body = (reading.value ?? {}) as RecordRow;
    if (!create && isEmpty(body)) return;
    const focused = document.activeElement;
    busy.value = true;
    const outcome = await write(collection.segment, uuid, body);
    busy.value = false;
    // The saving fieldset blurs whatever was focused; the element survives the save, so restore.
    if (focused instanceof HTMLElement && focused.isConnected) focused.focus();
    if (outcome.kind === 'saved') {
      live.rebase(outcome.record);
      settle(outcome.record);
      seedRecordLabel(collection, outcome.record);
      toast(t('dashboard.saved'), { type: 'success', description: heading.value });
      if (!isNull(pending.value)) {
        resume();
        return;
      }
      if (create && isString(outcome.record.UUID)) {
        navigate(`${listPath}/${outcome.record.UUID}`, { replace: true });
      }
      return;
    }
    if (outcome.kind === 'invalid') {
      orphan.value = live.setErrors(outcome.errors);
      live.focusError();
      return;
    }
    if (outcome.kind === 'gone') {
      live.revert();
      toast(t('dashboard.record.gone'), { type: 'error' });
      navigate(listPath, { replace: true });
      return;
    }
    orphan.value = t(
      outcome.kind === 'unreachable' ? 'dashboard.unreachable' : 'dashboard.writeFailed',
    );
  };

  const disarm = (): void => {
    armed.value = false;
    if (!isUndefined(armTimer)) clearTimeout(armTimer);
  };

  const remove = async (): Promise<void> => {
    if (create || busy.value) return;
    if (!armed.value) {
      armed.value = true;
      armTimer = setTimeout(disarm, 4000);
      return;
    }
    disarm();
    busy.value = true;
    await deleteRecord(collection.segment, id);
    busy.value = false;
    form.value?.revert();
    toast(t('dashboard.deleted', { count: 1 }), { type: 'error' });
    navigate(listPath, { replace: true });
  };

  const title = (): string => (create ? t('dashboard.newRecord') : heading.value);

  const copyUUID = (): void => {
    if (create) return;
    void navigator.clipboard
      .writeText(id)
      .then(() => toast(t('dashboard.record.copied'), { type: 'success' }));
  };

  const saveButton = button(
    () => [t('dashboard.save'), h('span', { class: 'record-save-keys' }, '⌘S')],
    { type: 'submit', disabled: () => busy.value || !dirty() },
  );
  saveButton.setAttribute('form', formID);

  const bar = h(
    'div',
    { class: 'record-bar' },
    h(
      'span',
      { class: 'record-crumb' },
      h('a', { href: '/' }, () => t('dashboard.collections')),
      ' / ',
      h('a', { href: listPath }, collection.label),
      ' / ',
      h('b', null, title),
    ),
    create
      ? null
      : [
          h(
            'button',
            {
              class: 'record-chip',
              type: 'button',
              title: id,
              onClick: copyUUID,
            },
            icon('copy'),
            id.slice(0, 8),
          ),
          h('span', { class: 'record-chip' }, icon('clock'), () => updatedText(updatedAt.value)),
        ],
    when(
      () => !isNull(pending.value),
      () =>
        h(
          'div',
          { class: 'record-guard' },
          h('span', { class: 'record-guard-note' }, () => t('dashboard.record.unsaved')),
          button(() => t('dashboard.record.keepEditing'), {
            variant: 'ghost',
            onClick: () => {
              pending.value = null;
            },
          }),
          button(() => t('dashboard.record.discard'), {
            variant: 'ghost',
            destructiveHover: true,
            onClick: () => {
              form.value?.revert();
              resume();
            },
          }),
          button(() => t('dashboard.save'), {
            disabled: () => busy.value,
            onClick: () => void save(),
          }),
        ),
      () =>
        h(
          'div',
          { class: 'record-actions' },
          when(
            () => dirty(),
            () =>
              button(() => t('dashboard.record.revert'), {
                variant: 'ghost',
                disabled: () => busy.value,
                onClick: () => form.value?.revert(),
              }),
          ),
          !create && collection.operations.delete?.allowed === true
            ? button(() => (armed.value ? t('dashboard.confirmDelete') : t('dashboard.delete')), {
                variant: 'ghost',
                destructiveHover: true,
                disabled: () => busy.value,
                onClick: () => void remove(),
              })
            : null,
          readOnly ? null : saveButton,
        ),
    ),
  );

  return h(
    'div',
    { class: 'record-editor' },
    bar,
    h('div', { class: 'record-body' }, () => {
      if (state.value === 'failed') {
        return h(
          'div',
          { class: 'record-missing' },
          () => t('dashboard.unreachable'),
          button(() => t('dashboard.retry'), { variant: 'outline', onClick: () => void load() }),
        );
      }
      if (state.value === 'loading') return skeleton();
      if (state.value === 'missing') {
        return h(
          'div',
          { class: 'record-missing' },
          () => t('dashboard.notFound'),
          button(() => collection.label, { variant: 'outline', onClick: () => navigate(listPath) }),
        );
      }
      const live = form.value;
      if (isUndefined(live)) return null;
      return h(
        'form',
        {
          class: 'record-column',
          id: formID,
          novalidate: true,
          onSubmit: (event: SubmitEvent) => {
            event.preventDefault();
            void save();
          },
        },
        () => (orphan.value === '' ? null : h('div', { class: 'record-orphan' }, orphan.value)),
        h('fieldset', { class: 'record-fields', disabled: () => busy.value }, live.render()),
      );
    }),
  );
}

/**
 * Reads the record by `UUID` through the body-query endpoint.
 * Resolves the row, `null` when the collection has no such record, `undefined` on failure.
 */
async function readRecord(segment: string, uuid: string): Promise<RecordRow | null | undefined> {
  try {
    const response = await api(`POST /collections/${segment}/query`, {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ where: { UUID: uuid }, perPage: 1 }),
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
 */
async function write(
  segment: string,
  uuid: string | undefined,
  body: RecordRow,
): Promise<WriteOutcome> {
  const send = (): Promise<Response> =>
    api(
      isUndefined(uuid) ? `POST /collections/${segment}` : `PATCH /collections/${segment}/${uuid}`,
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
 * Deletes the record, retrying once on a busy `503`; a failure surfaces on the list reload.
 */
async function deleteRecord(segment: string, uuid: string): Promise<void> {
  const send = (): Promise<Response> => api(`DELETE /collections/${segment}/${uuid}`);
  try {
    const response = await send();
    if (response.status === 503) {
      await sleep(1000);
      await send();
    }
  } catch {
    /* the list shows what survived */
  }
}

/**
 * The record's display title: its first plain text field's value, or the short `UUID`.
 */
function titleOf(collection: DashboardCollection, row: RecordRow): string {
  const field = labelField(collection);
  if (!isUndefined(field)) {
    const value = row[field.name];
    if (isString(value) && value !== '') return value;
  }
  const id = row.UUID;
  return isString(id) ? id.slice(0, 8) : '';
}

/**
 * Seeds the label cache with the saved record's own label, so relation cells resolve it for free.
 */
function seedRecordLabel(collection: DashboardCollection, row: RecordRow): void {
  const field = labelField(collection);
  if (isUndefined(field)) return;
  const value = row[field.name];
  if (isString(row.UUID) && isString(value) && value !== '') {
    seedLabel(collection.name, row.UUID, value);
  }
}

/**
 * The collection's first readable plain text field, the one that names a record.
 */
function labelField(collection: DashboardCollection): DashboardField | undefined {
  return collection.fields.find(
    (field) =>
      field.readable &&
      field.kind === 'column' &&
      field.logicalType === 'text' &&
      field.type !== 'password' &&
      field.name !== 'UUID',
  );
}

/**
 * The updated chip's text, formatted for the active language.
 */
function updatedText(value: number | undefined): string {
  if (!isNumber(value)) return '';
  const language = useDashboardLanguage().value;
  let format = dateFormats.get(language);
  if (isUndefined(format)) {
    format = new Intl.DateTimeFormat(language, { dateStyle: 'short', timeStyle: 'short' });
    dateFormats.set(language, format);
  }
  return format.format(value);
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
 * The loading placeholder: dim field-row bars instead of a spinner.
 */
function skeleton(): Child {
  const widths = ['32%', '58%', '44%', '66%', '38%', '52%'];
  return h(
    'div',
    { class: 'record-skeleton' },
    widths.map((width) => h('i', { style: `width:${width}` })),
  );
}

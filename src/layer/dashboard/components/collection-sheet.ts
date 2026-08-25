import {
  api,
  button,
  type Child,
  createRowChecks,
  createSheetSelection,
  css,
  type DashboardCollection,
  type DashboardField,
  dimMark,
  fieldTypeFor,
  h,
  icon,
  navigate,
  seedLabel,
  sheet,
  type SheetColumn,
  type SheetModel,
  type SheetPage,
  toast,
  useDashboardLanguage,
  useT,
  when,
} from 'ohne/dashboard';
import {
  debounce,
  effect,
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
type SheetRecord = Record<string, unknown>;

/**
 * The `_updatedAt` renderings: time-only for today, short date otherwise, medium for the tooltip.
 */
type DateVariant = 'time' | 'short' | 'full';

const PER_PAGE = 50;

const DATE_OPTIONS: Record<DateVariant, Intl.DateTimeFormatOptions> = {
  time: { timeStyle: 'short' },
  short: { dateStyle: 'short', timeStyle: 'short' },
  full: { dateStyle: 'medium', timeStyle: 'short' },
};

const dateFormats = new Map<string, Intl.DateTimeFormat>();

const sheetMemory = new Map<string, { page: number; search: string }>();

css`
  .collection-sheet {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  .collection-sheet > .ohne-sheet {
    flex: 1;
    border: none;
    border-radius: 0;
  }

  .sheet-bar {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--s3);
    height: var(--bar);
    padding: 0 var(--s4);
    background: var(--surface);
    border-bottom: 1px solid var(--line);
  }

  .sheet-crumb {
    color: var(--faint);
    white-space: nowrap;
  }

  .sheet-crumb b {
    color: var(--text);
    font-weight: 500;
  }

  .sheet-chip {
    font-family: var(--mono);
    font-size: var(--fs-micro);
    color: var(--dim);
    background: var(--raised);
    border: 1px solid var(--line);
    border-radius: 3px;
    padding: 2px 6px;
    white-space: nowrap;
  }

  .sheet-chip.armed {
    color: var(--accent);
    border-color: var(--accent);
  }

  .sheet-search {
    flex: none;
    width: 200px;
    transition:
      width var(--pace),
      border-color var(--pace),
      box-shadow var(--pace);
  }

  .sheet-search:focus {
    width: 280px;
  }

  .sheet-actions {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: var(--s2);
  }

  .sheet-empty-title {
    font-size: var(--fs-lead);
    font-weight: 500;
    color: var(--text);
  }
`;

/**
 * A collection's records in the sheet: paged reads, search, sort, inline editing, batch deletion.
 *
 * Reads page through the body-query endpoint, newest change first unless a header sort stands.
 * The toolbar search contains-matches the collection's label field, debounced, resetting to page 1.
 * A cell edit writes only its field; the answered record replaces the row.
 * A `422` lands on the cell as a danger ring with the message as its tooltip.
 * A cell that cannot edit in place opens the record page instead, composites deep-linking their field.
 * Checked rows arm the toolbar's two-step delete, which runs row by row and then reloads.
 * Page number and search text are remembered per segment, so sheet to record and back restores.
 * The `entry` accessor is reactive: a different collection or refreshed discovery data reloads.
 */
export function collectionSheet(entry: () => DashboardCollection | undefined): Child {
  const t = useT();
  const pageNumber = ref(1);
  const search = ref('');
  const sortState = ref<{ key: string; desc: boolean } | undefined>(undefined);
  const page = ref<SheetPage<SheetRecord> | undefined>(undefined);
  const reload = ref(0);
  const failed = ref(false);
  const cellErrors = ref<Readonly<Record<string, string>>>(emptyErrors());
  const armed = ref(false);
  const deleting = ref(false);
  const checks = createRowChecks();
  let generation = 0;
  let disarmTimer = 0;
  let restoredSegment: string | undefined;

  const disarm = (): void => {
    clearTimeout(disarmTimer);
    armed.value = false;
  };

  const arm = (): void => {
    armed.value = true;
    clearTimeout(disarmTimer);
    disarmTimer = setTimeout(disarm, 4000);
  };

  onCleanup(() => clearTimeout(disarmTimer));

  effect(() => {
    void checks.keys();
    disarm();
  });

  effect(() => {
    const current = entry();
    if (isUndefined(current) || restoredSegment === current.segment) return;
    restoredSegment = current.segment;
    const memory = sheetMemory.get(current.segment);
    pageNumber.value = memory?.page ?? 1;
    search.value = memory?.search ?? '';
    checks.clear();
  });

  effect(() => {
    const current = entry();
    const state = { page: pageNumber.value, search: search.value };
    if (isUndefined(current) || restoredSegment !== current.segment) return;
    sheetMemory.set(current.segment, state);
  });

  effect(() => {
    const current = entry();
    const number = pageNumber.value;
    const text = search.value;
    const order = sortState.value;
    void reload.value;
    if (isUndefined(current)) return;
    const mine = (generation += 1);
    page.value = undefined;
    failed.value = false;
    checks.clear();
    const body: Record<string, unknown> = {
      page: number,
      perPage: PER_PAGE,
      order: [isUndefined(order) ? '-_updatedAt' : order.desc ? `-${order.key}` : order.key],
    };
    const label = labelField(current);
    if (text !== '' && !isUndefined(label)) body.where = { [label.name]: { contains: text } };
    void loadPage(current.segment, body).then((loaded) => {
      if (generation !== mine) return;
      if (isUndefined(loaded)) {
        failed.value = true;
        return;
      }
      // Deleting a whole last page leaves the request beyond the set; the server answers it empty
      // rather than clamping, which would otherwise render as an empty collection.
      if (loaded.records.length === 0 && loaded.page > loaded.lastPage) {
        pageNumber.value = loaded.lastPage;
        return;
      }
      page.value = loaded;
      seedLabels(current, loaded.records);
    });
  });

  const fields = (): DashboardField[] =>
    (entry()?.fields ?? []).filter((field) => field.readable || field.writable);
  const fieldByName = (name: string): DashboardField | undefined =>
    fields().find((field) => field.name === name);
  const searchField = (): DashboardField | undefined => {
    const current = entry();
    return isUndefined(current) ? undefined : labelField(current);
  };

  const selection = createSheetSelection(() => ({
    rows: page.value?.records.length ?? 0,
    columns: fields().length,
  }));

  const toggleSort = (key: string): void => {
    const current = sortState.value;
    if (current?.key !== key) sortState.value = { key, desc: false };
    else if (!current.desc) sortState.value = { key, desc: true };
    else sortState.value = undefined;
  };

  const errorOf = (row: SheetRecord, name: string): string | undefined =>
    cellErrors.value[`${String(row.UUID)}:${name}`];

  const replaceRow = (uuid: string, record: SheetRecord): void => {
    const current = page.value;
    if (isUndefined(current)) return;
    page.value = {
      ...current,
      records: current.records.map((row) => (row.UUID === uuid ? { ...row, ...record } : row)),
    };
  };

  const commitEdit = async (
    segment: string,
    uuid: string,
    name: string,
    value: unknown,
  ): Promise<{ close: boolean; record?: SheetRecord; errors?: Record<string, string> }> => {
    const key = `${uuid}:${name}`;
    const response = await writeField(segment, uuid, name, value);
    if (isUndefined(response)) {
      cellErrors.value = withError(cellErrors.value, key, t('dashboard.unreachable'));
      return { close: false };
    }
    if (response.ok) {
      cellErrors.value = withoutError(cellErrors.value, key);
      toast(t('dashboard.saved'), { type: 'success', description: fieldByName(name)?.label });
      return { close: true, record: (await response.json()) as SheetRecord };
    }
    if (response.status === 422) {
      const body = (await response.json()) as { data?: { errors?: Record<string, string> } };
      const errors = Object.assign(emptyErrors(), body.data?.errors ?? {});
      const message = errors[name] ?? Object.values(errors)[0] ?? '';
      cellErrors.value = withError(cellErrors.value, key, message);
      return { close: false, errors };
    }
    if (response.status === 404) {
      reload.value += 1;
      return { close: true };
    }
    cellErrors.value = withError(cellErrors.value, key, t('dashboard.writeFailed'));
    return { close: false };
  };

  const checkedUUIDs = (): string[] => {
    const current = page.value;
    if (isUndefined(current)) return [];
    return current.records
      .map((row) => row.UUID)
      .filter(isString)
      .filter((uuid) => checks.has(uuid));
  };

  const runDelete = async (): Promise<void> => {
    const current = entry();
    const uuids = checkedUUIDs();
    if (isUndefined(current) || uuids.length === 0) return;
    clearTimeout(disarmTimer);
    deleting.value = true;
    let lost = 0;
    for (const uuid of uuids) {
      if (!(await deleteRecord(current.segment, uuid))) lost += 1;
    }
    deleting.value = false;
    disarm();
    checks.clear();
    reload.value += 1;
    if (lost === 0) {
      toast(t('dashboard.deleted', { count: uuids.length }), { type: 'error' });
    } else {
      toast(t('dashboard.deletedPartial', { count: uuids.length - lost, failed: lost }), {
        type: 'error',
      });
    }
  };

  const commitSearch = (text: string): void => {
    if (search.value === text) return;
    search.value = text;
    pageNumber.value = 1;
    checks.clear();
  };
  const applySearch = debounce(commitSearch, 200);
  onCleanup(() => applySearch.cancel());

  const searchInput = h('input', {
    class: 'ohne-input sheet-search',
    type: 'text',
    placeholder: () => searchField()?.label ?? '',
    'aria-label': () => searchField()?.label ?? '',
    onInput: () => applySearch(searchInput.value),
    onKeydown: (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      clearSearch();
      grid.focus();
    },
  }) as HTMLInputElement;

  const clearSearch = (): void => {
    applySearch.cancel();
    searchInput.value = '';
    commitSearch('');
  };

  effect(() => {
    const text = search.value;
    if (searchInput.value !== text) searchInput.value = text;
  });

  const onRootKeydown = (event: KeyboardEvent): void => {
    if (event.key !== '/' || isUndefined(searchField())) return;
    const target = event.target;
    if (
      target instanceof Element &&
      !isNull(target.closest('a, button, input, select, textarea'))
    ) {
      return;
    }
    event.preventDefault();
    searchInput.focus();
  };

  const rowHref = (row: SheetRecord): string | undefined => {
    const current = entry();
    if (isUndefined(current) || !isString(row.UUID)) return undefined;
    return `/collections/${current.segment}/${row.UUID}`;
  };

  const open = (row: SheetRecord, column?: SheetColumn): void => {
    const href = rowHref(row);
    if (isUndefined(href)) return;
    const field = isUndefined(column) ? undefined : fieldByName(column.key);
    if (!isUndefined(field) && compositeKind(field)) {
      navigate(`${href}#field-${field.name}`);
      return;
    }
    navigate(href);
  };

  const newLink = (): Child =>
    h(
      'a',
      { class: 'ohne-button solid', href: () => `/collections/${entry()?.segment ?? ''}/new` },
      icon('plus'),
      () => t('dashboard.new'),
    );

  const model: SheetModel<SheetRecord> = {
    columns: () =>
      fields().map(
        (field): SheetColumn => ({
          key: field.name,
          label: field.label,
          numeric: numericColumn(field),
          center: centerColumn(field),
          width: columnWidth(field),
        }),
      ),
    page: () => page.value,
    rowKey: (row, index) => String(row.UUID ?? index),
    cell: (row, column) => () => {
      const field = fieldByName(column.key);
      if (isUndefined(field)) return null;
      const content = displayFor(field, row);
      const message = errorOf(row(), column.key);
      return isUndefined(message) ? content : h('span', { title: message }, content);
    },
    setPage: (number) => {
      pageNumber.value = number;
    },
    checks,
    rowHref,
    open,
    openLabel: () => t('dashboard.open'),
    sort: () => sortState.value,
    toggleSort,
    sortable: (column) => {
      const field = fieldByName(column.key);
      if (isUndefined(field)) return false;
      return field.kind === 'column' || field.kind === 'record' || field.name === '_updatedAt';
    },
    failed: () => failed.value,
    failure: () => [
      h('div', { class: 'sheet-empty-title' }, t('dashboard.unreachable')),
      button(() => t('dashboard.retry'), {
        variant: 'outline',
        onClick: () => {
          reload.value += 1;
        },
      }),
    ],
    dangerRows: () => armed.value,
    canEdit: (row, column) => {
      const field = fieldByName(column.key);
      if (isUndefined(field) || entry()?.operations.update?.allowed !== true) return false;
      if (!field.writable || field.immutable) return false;
      return !isUndefined(fieldTypeFor(field).editor) && isString(row.UUID);
    },
    editor: (row, column, close) => {
      const collection = entry();
      const field = fieldByName(column.key);
      if (isUndefined(collection) || isUndefined(field)) return undefined;
      const editor = fieldTypeFor(field).editor;
      if (isUndefined(editor)) return undefined;
      const uuid = row().UUID;
      if (!isString(uuid)) return undefined;
      const key = `${uuid}:${field.name}`;
      return editor({
        field,
        value: () => row()[field.name],
        language: () => useDashboardLanguage().value,
        commit: (value) =>
          commitEdit(collection.segment, uuid, field.name, value).then((outcome) => {
            if (outcome.close) close();
            if (!isUndefined(outcome.record)) replaceRow(uuid, outcome.record);
            return { landed: outcome.close, errors: outcome.errors };
          }),
        cancel: () => {
          cellErrors.value = withoutError(cellErrors.value, key);
          close();
        },
      });
    },
    invalid: (row, column) => !isUndefined(errorOf(row, column.key)),
    empty: () =>
      search.value === ''
        ? [
            h('div', { class: 'sheet-empty-title' }, t('dashboard.empty.title')),
            h('div', null, t('dashboard.empty.body')),
            entry()?.operations.create?.allowed === true ? newLink() : null,
          ]
        : [
            h('div', { class: 'sheet-empty-title' }, t('dashboard.noMatches')),
            button(() => t('dashboard.clearSearch'), { variant: 'ghost', onClick: clearSearch }),
          ],
    hints: () => {
      if (checks.count() > 0) {
        return [
          { keys: 'space', label: t('dashboard.hints.check') },
          { keys: 'esc', label: t('dashboard.hints.clear') },
        ];
      }
      const base = [
        { keys: '↑↓←→', label: t('dashboard.hints.move') },
        { keys: '⏎', label: t('dashboard.hints.edit') },
        { keys: '⌘⏎', label: t('dashboard.hints.open') },
      ];
      if (!isUndefined(searchField())) base.push({ keys: '/', label: t('dashboard.hints.search') });
      return base;
    },
  };

  const grid = sheet(model, selection) as HTMLElement;

  return h(
    'div',
    { class: 'collection-sheet', onKeydown: onRootKeydown },
    h(
      'div',
      { class: 'sheet-bar' },
      h(
        'span',
        { class: 'sheet-crumb' },
        () => t('dashboard.collections'),
        ' / ',
        h('b', null, () => entry()?.label),
      ),
      h('span', { class: 'sheet-chip' }, () => {
        const current = page.value;
        return isUndefined(current) ? '' : t('dashboard.records', { count: current.total });
      }),
      when(
        () => !isUndefined(searchField()),
        () => searchInput,
      ),
      h(
        'div',
        { class: 'sheet-actions' },
        when(
          () => checks.count() > 0,
          () => [
            h('span', { class: 'sheet-chip armed' }, () =>
              t('dashboard.selected', { count: checks.count() }),
            ),
            when(
              () => entry()?.operations.delete?.allowed === true,
              () =>
                button(
                  () =>
                    armed.value
                      ? t('dashboard.confirmDeleteCount', { count: checks.count() })
                      : t('dashboard.delete'),
                  {
                    variant: 'ghost',
                    destructiveHover: true,
                    disabled: () => deleting.value,
                    onClick: () => {
                      if (armed.value) {
                        void runDelete();
                        return;
                      }
                      arm();
                    },
                  },
                ),
            ),
          ],
        ),
        when(() => entry()?.operations.create?.allowed === true, newLink),
      ),
    ),
    grid,
  );
}

/**
 * Loads one page through `POST /collections/[segment]/query`; a failure resolves `undefined`.
 */
async function loadPage(
  segment: string,
  body: Record<string, unknown>,
): Promise<SheetPage<SheetRecord> | undefined> {
  try {
    const response = await api(`POST /collections/${segment}/query`, {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) return undefined;
    return (await response.json()) as SheetPage<SheetRecord>;
  } catch {
    return undefined;
  }
}

/**
 * Sends one field's `PATCH`, retrying once on a busy `503`; a network failure resolves `undefined`.
 */
async function writeField(
  segment: string,
  uuid: string,
  name: string,
  value: unknown,
): Promise<Response | undefined> {
  const send = (): Promise<Response> =>
    api(`PATCH /collections/${segment}/${uuid}`, {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ [name]: value }),
    });
  try {
    const response = await send();
    if (response.status !== 503) return response;
    await sleep(1000);
    return await send();
  } catch {
    return undefined;
  }
}

/**
 * Deletes one record, retrying once on a busy `503`.
 * Resolves whether the record is gone: any `2xx`, and a `404` that means it already was.
 */
async function deleteRecord(segment: string, uuid: string): Promise<boolean> {
  const send = (): Promise<Response> => api(`DELETE /collections/${segment}/${uuid}`);
  try {
    let response = await send();
    if (response.status === 503) {
      await sleep(1000);
      response = await send();
    }
    return response.ok || response.status === 404;
  } catch {
    return false;
  }
}

/**
 * Seeds the label cache from a loaded page, so relation cells naming these rows resolve free.
 */
function seedLabels(collection: DashboardCollection, records: readonly SheetRecord[]): void {
  const label = labelField(collection);
  if (isUndefined(label)) return;
  for (const row of records) {
    const uuid = row.UUID;
    const value = row[label.name];
    if (isString(uuid) && isString(value) && value !== '') {
      seedLabel(collection.name, uuid, value);
    }
  }
}

/**
 * The collection's first plain readable text field.
 * It is the label heuristic the search box, the search query, and the label seeding share.
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
 * Whether the field is a composite kind, whose cell opens the record page at the field's row.
 */
function compositeKind(field: DashboardField): boolean {
  return (
    field.kind === 'records' ||
    field.kind === 'childOne' ||
    field.kind === 'childMany' ||
    field.kind === 'blocks'
  );
}

/**
 * The cell's display content: system fields render specially, the rest through their field type.
 */
function displayFor(field: DashboardField, row: () => SheetRecord): Child {
  if (field.name === '_updatedAt') {
    return () => {
      const value = row()['_updatedAt'];
      if (!isNumber(value)) return dimMark('·');
      const language = useDashboardLanguage().value;
      const variant: DateVariant = isToday(value) ? 'time' : 'short';
      return h(
        'span',
        { title: dateFormat(language, 'full').format(value) },
        dateFormat(language, variant).format(value),
      );
    };
  }
  if (field.name === 'UUID') {
    return () => {
      const value = row()['UUID'];
      if (!isString(value)) return dimMark('·');
      return h('span', { class: 'cell-mono cell-dim', title: value }, value.slice(0, 8));
    };
  }
  return fieldTypeFor(field).display({
    field,
    value: () => row()[field.name],
    language: () => useDashboardLanguage().value,
  });
}

/**
 * Whether the column right-aligns: integer and real columns, except the date-rendered `_updatedAt`.
 */
function numericColumn(field: DashboardField): boolean {
  if (field.name === '_updatedAt') return false;
  return field.logicalType === 'integer' || field.logicalType === 'real';
}

/**
 * Whether the column centers: only the boolean marks.
 */
function centerColumn(field: DashboardField): boolean {
  return field.logicalType === 'boolean';
}

/**
 * The column's fixed width by what it shows; text columns share the remaining room.
 */
function columnWidth(field: DashboardField): number | undefined {
  if (field.name === 'UUID') return 104;
  if (field.name === '_updatedAt') return 150;
  if (field.logicalType === 'boolean') return 64;
  if (field.logicalType === 'integer' || field.logicalType === 'real') return 96;
  if (field.kind === 'record') return 180;
  if (field.kind !== 'column') return 140;
  return undefined;
}

/**
 * A fresh error map with no prototype, since field paths may collide with `Object` keys.
 */
function emptyErrors(): Record<string, string> {
  return Object.create(null) as Record<string, string>;
}

/**
 * A copy of `errors` with `key` set to `message`.
 */
function withError(
  errors: Readonly<Record<string, string>>,
  key: string,
  message: string,
): Record<string, string> {
  const next = Object.assign(emptyErrors(), errors);
  next[key] = message;
  return next;
}

/**
 * A copy of `errors` without `key`.
 */
function withoutError(
  errors: Readonly<Record<string, string>>,
  key: string,
): Record<string, string> {
  const next = Object.assign(emptyErrors(), errors);
  delete next[key];
  return next;
}

/**
 * Whether the timestamp falls on the viewer's local today.
 */
function isToday(timestamp: number): boolean {
  const date = new Date(timestamp);
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

/**
 * The memoized `_updatedAt` formatter for `language` in `variant`.
 */
function dateFormat(language: string, variant: DateVariant): Intl.DateTimeFormat {
  const key = `${language} ${variant}`;
  let format = dateFormats.get(key);
  if (isUndefined(format)) {
    format = new Intl.DateTimeFormat(language, DATE_OPTIONS[variant]);
    dateFormats.set(key, format);
  }
  return format;
}

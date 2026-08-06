import {
  api,
  type Child,
  createSheetSelection,
  css,
  type DashboardCollection,
  type DashboardField,
  dimMark,
  fieldCellFor,
  h,
  sheet,
  type SheetColumn,
  type SheetModel,
  type SheetPage,
  useDashboardLanguage,
  useT,
  when,
} from 'ohne/dashboard';
import { button } from 'ohne/dashboard';
import { effect, isNull, isNumber, isString, isUndefined, ref, sleep } from 'ohne/utils';

import './cells.ts';
import { createRecord } from './create-record.ts';

/**
 * One record row, as the collections API answers it.
 */
type SheetRecord = Record<string, unknown>;

const PER_PAGE = 50;

const dateFormats = new Map<string, Intl.DateTimeFormat>();

css`
  .sheet-toolbar {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-bottom: 10px;
  }

  .sheet-toolbar-selected {
    margin-left: auto;
  }

  .ohne-button.ghost.sheet-toolbar-delete,
  .ohne-button.ghost.sheet-toolbar-delete:hover:not(:disabled) {
    color: var(--danger);
  }
`;

/**
 * A collection's records in the sheet: paged reads, inline editing, and batch deletion.
 *
 * Reads page through the body-query endpoint, newest change first.
 * A cell edit writes only its field; the answered record replaces the row, so the sheet shows
 * the write's final state.
 * A `422` lands on the cell as a danger ring with the message as its tooltip.
 * Selecting rows arms the toolbar's two-step delete, which runs row by row and then reloads.
 * The `entry` accessor is reactive: a different collection or refreshed discovery data reloads.
 */
export function collectionSheet(entry: () => DashboardCollection | undefined): Child {
  const t = useT();
  const pageNumber = ref(1);
  const page = ref<SheetPage<SheetRecord> | undefined>(undefined);
  const reload = ref(0);
  const cellErrors = ref<Readonly<Record<string, string>>>(emptyErrors());
  const armed = ref(false);
  const creating = ref(false);
  const deleting = ref(false);
  let generation = 0;

  effect(() => {
    const current = entry();
    const number = pageNumber.value;
    void reload.value;
    if (isUndefined(current)) return;
    const mine = (generation += 1);
    page.value = undefined;
    void loadPage(current.segment, number).then((loaded) => {
      if (generation === mine && !isUndefined(loaded)) page.value = loaded;
    });
  });

  const fields = (): DashboardField[] =>
    (entry()?.fields ?? []).filter((field) => field.readable || field.writable);
  const fieldByName = (name: string): DashboardField | undefined =>
    fields().find((field) => field.name === name);

  const selection = createSheetSelection(() => ({
    rows: page.value?.records.length ?? 0,
    columns: fields().length,
  }));

  effect(() => {
    void selection.range();
    armed.value = false;
  });

  const selectedUUIDs = (): string[] => {
    const rect = selection.range();
    const current = page.value;
    if (isNull(rect) || isUndefined(current)) return [];
    return current.records
      .slice(rect.top, rect.bottom + 1)
      .map((row) => row.UUID)
      .filter(isString);
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
  ): Promise<{ close: boolean; record?: SheetRecord }> => {
    const key = `${uuid}:${name}`;
    const response = await writeField(segment, uuid, name, value);
    if (isUndefined(response)) {
      cellErrors.value = withError(cellErrors.value, key, t('dashboard.unreachable'));
      return { close: false };
    }
    if (response.ok) {
      cellErrors.value = withoutError(cellErrors.value, key);
      return { close: true, record: (await response.json()) as SheetRecord };
    }
    if (response.status === 422) {
      const body = (await response.json()) as { data?: { errors?: Record<string, string> } };
      const errors = body.data?.errors ?? {};
      const message = errors[name] ?? Object.values(errors)[0] ?? '';
      cellErrors.value = withError(cellErrors.value, key, message);
      return { close: false };
    }
    if (response.status === 404) {
      reload.value += 1;
      return { close: true };
    }
    cellErrors.value = withError(cellErrors.value, key, t('dashboard.writeFailed'));
    return { close: false };
  };

  const runDelete = async (): Promise<void> => {
    const current = entry();
    const uuids = selectedUUIDs();
    if (isUndefined(current) || uuids.length === 0) return;
    deleting.value = true;
    for (const uuid of uuids) await deleteRecord(current.segment, uuid);
    deleting.value = false;
    armed.value = false;
    selection.clear();
    reload.value += 1;
  };

  const model: SheetModel<SheetRecord> = {
    columns: () =>
      fields().map(
        (field): SheetColumn => ({
          key: field.name,
          label: field.label,
          numeric: numericColumn(field),
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
    canEdit: (row, column) => {
      const field = fieldByName(column.key);
      if (isUndefined(field) || entry()?.operations.update?.allowed !== true) return false;
      if (!field.writable || field.immutable) return false;
      return !isUndefined(fieldCellFor(field).editor) && isString(row.UUID);
    },
    editor: (row, column, close) => {
      const collection = entry();
      const field = fieldByName(column.key);
      if (isUndefined(collection) || isUndefined(field)) return undefined;
      const editor = fieldCellFor(field).editor;
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
            return outcome.close;
          }),
        cancel: () => {
          cellErrors.value = withoutError(cellErrors.value, key);
          close();
        },
      });
    },
    invalid: (row, column) => !isUndefined(errorOf(row, column.key)),
  };

  return h(
    'div',
    null,
    h(
      'div',
      { class: 'sheet-toolbar' },
      h('span', { class: 'ohne-caps' }, () => {
        const current = page.value;
        return isUndefined(current) ? '' : t('dashboard.records', { count: current.total });
      }),
      when(
        () => entry()?.operations.create?.allowed === true,
        () =>
          button(() => t('dashboard.new'), {
            kind: 'ghost',
            onClick: () => {
              creating.value = true;
            },
          }),
      ),
      when(
        () => selectedUUIDs().length > 0,
        () => [
          h('span', { class: 'ohne-caps sheet-toolbar-selected' }, () =>
            t('dashboard.selected', { count: selectedUUIDs().length }),
          ),
          when(
            () => entry()?.operations.delete?.allowed === true,
            () =>
              button(() => (armed.value ? t('dashboard.confirmDelete') : t('dashboard.delete')), {
                kind: 'ghost',
                class: 'sheet-toolbar-delete',
                disabled: () => deleting.value,
                onClick: () => {
                  if (!armed.value) {
                    armed.value = true;
                    return;
                  }
                  void runDelete();
                },
              }),
          ),
        ],
      ),
    ),
    sheet(model, selection),
    when(
      () => creating.value,
      () => {
        const current = entry();
        if (isUndefined(current)) return null;
        return createRecord(current, (created) => {
          creating.value = false;
          if (created) reload.value += 1;
        });
      },
    ),
  );
}

/**
 * Loads one page through `POST /collections/[segment]/query`; a failure resolves `undefined`.
 */
async function loadPage(
  segment: string,
  page: number,
): Promise<SheetPage<SheetRecord> | undefined> {
  try {
    const response = await api(`POST /collections/${segment}/query`, {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ page, perPage: PER_PAGE, order: ['-_updatedAt'] }),
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
 * Deletes one record, retrying once on a busy `503`; failures stay visible after the reload.
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
    /* the reload shows what survived */
  }
}

/**
 * The cell's display content: system fields render specially, the rest through their type's cell.
 */
function displayFor(field: DashboardField, row: () => SheetRecord): Child {
  if (field.name === '_updatedAt') {
    return () => {
      const value = row()['_updatedAt'];
      return isNumber(value)
        ? dateFormat(useDashboardLanguage().value).format(value)
        : dimMark('·');
    };
  }
  if (field.name === 'UUID') {
    return () => {
      const value = row()['UUID'];
      return isString(value) ? h('span', { class: 'cell-mono' }, value) : dimMark('·');
    };
  }
  return fieldCellFor(field).display({
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
 * The memoized date formatter for `language`.
 */
function dateFormat(language: string): Intl.DateTimeFormat {
  let format = dateFormats.get(language);
  if (isUndefined(format)) {
    format = new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' });
    dateFormats.set(language, format);
  }
  return format;
}

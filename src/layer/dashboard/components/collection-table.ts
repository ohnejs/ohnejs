import {
  api,
  attachTooltip,
  bubble,
  button,
  type Child,
  css,
  type DashboardCollection,
  type DashboardField,
  dimMark,
  dropdown,
  dropdownItem,
  fieldTypeFor,
  h,
  hasModifierKey,
  icon,
  isEditingText,
  navigate,
  openDialog,
  overlayCount,
  pagination,
  popup,
  queueToast,
  seedLabel,
  type TableColumns,
  type TableRow,
  type TableSort,
  table,
  tableColumn,
  toast,
  useDashboardLanguage,
  useHotkeys,
  useT,
  when,
} from 'ohne/dashboard';
import {
  computed,
  type ConditionObject,
  effect,
  isNumber,
  isString,
  isUndefined,
  onCleanup,
  type Ref,
  ref,
  sleep,
} from 'ohne/utils';

import {
  parseTableState,
  resolveTableColumns,
  serializeTableState,
  sortFromOrder,
  stripEditParam,
  type TableURLState,
} from './collection-table-state.ts';
import { activeContentLocale } from './content-language-switcher.ts';
import { dataTablePopup } from './data-table-popup.ts';
import { editableFieldCell } from './editable-field-cell.ts';
import { unsavedChanges } from './history.ts';
import { orderBy } from './order-by.ts';

/**
 * One record row, as the collections API answers it.
 */
type TableRecord = Record<string, unknown>;

/**
 * One page of records, as the body-query endpoint answers it.
 */
interface QueryPage {
  records: TableRecord[];
  page: number;
  lastPage: number;
  perPage: number;
  total: number;
}

/**
 * The `_updatedAt` renderings: time-only for today, short date otherwise, medium for the tooltip.
 */
type DateVariant = 'time' | 'short' | 'full';

const PER_PAGE = 50;

const DEFAULT_ORDER: readonly string[] = ['-_updatedAt'];

const DATE_OPTIONS: Record<DateVariant, Intl.DateTimeFormatOptions> = {
  time: { timeStyle: 'short' },
  short: { dateStyle: 'short', timeStyle: 'short' },
  full: { dateStyle: 'medium', timeStyle: 'short' },
};

const dateFormats = new Map<string, Intl.DateTimeFormat>();

const tableMemory = new Map<string, string>();

css`
  .o-collection-table {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .o-collection-table-scroller {
    overflow: auto;
    outline: none;
    flex: 1;
  }

  .o-collection-table-empty .ohne-table {
    min-height: 100%;
  }

  .o-collection-table-footer {
    position: sticky;
    margin-top: auto;
    padding: 0.75rem;
    background-color: hsl(var(--ohne-background));
  }

  .o-collection-table-footer::before {
    content: '';
    position: absolute;
    right: 0;
    bottom: 100%;
    left: 0;
    height: 1px;
    background-color: hsl(var(--ohne-border));
  }

  .o-collection-table-footer > :where(div):first-child {
    margin-right: auto;
  }

  .o-collection-table-footer > :where(:not(div)):first-child {
    margin-left: auto;
  }

  .o-collection-table-footer .ohne-pagination-buttons {
    margin: -0.75rem -0.25rem;
    padding: 0.75rem 0.25rem;
  }

  .o-collection-table-title {
    font-weight: 500;
  }
`;

/**
 * The collection table page body, ported from Pruvious v4's collection index page.
 *
 * The state lives in the URL: `page`, `order`, `where`, and `columns` are query params.
 * A reload or back and forward re-renders the same view.
 * The last query string per segment is remembered and restored when the collection is revisited bare.
 * Every cell renders its field's display inside an editable cell whose popup patches only that field.
 * Sorting, the filter and sorting popups, and the pagination push new URL state.
 * Rows select with shift ranges into the batch delete.
 * A row's actions menu opens, edits, and deletes single records with the source's confirm dialogs.
 * Reads page through the body-query endpoint exactly as the sheet did.
 * Deletes run record by record with the sheet's toasts.
 */
export function collectionTable(collection: DashboardCollection): HTMLElement {
  const t = useT();
  const segment = collection.segment;
  const canCreate = collection.operations.create?.allowed === true;
  const canUpdate = collection.operations.update?.allowed === true;
  const canDelete = collection.operations.delete?.allowed === true;

  const remembered = tableMemory.get(segment) ?? '';
  const redirected = location.search === '' && remembered !== '';
  if (redirected) {
    queueMicrotask(() => navigate(location.pathname + remembered, { replace: true }));
  } else {
    tableMemory.set(segment, stripEditParam(location.search));
  }

  const state = parseTableState(location.search, DEFAULT_ORDER);
  const whereDirty = !isUndefined(state.where);

  const push = (patch: Partial<TableURLState>, replace = false): void => {
    const next: TableURLState = {
      page: patch.page ?? state.page,
      order: patch.order ?? state.order,
      where: Object.hasOwn(patch, 'where') ? patch.where : state.where,
      columns: state.columns,
    };
    const query = serializeTableState(next, DEFAULT_ORDER, location.search);
    const search = query === '' ? '' : `?${query}`;
    tableMemory.set(segment, stripEditParam(search));
    navigate(location.pathname + search, { replace });
  };

  const specs = resolveTableColumns(collection.fields, state.columns);
  const columns: TableColumns = {};
  for (const spec of specs) {
    const definition: Parameters<typeof tableColumn>[0] = {
      label: spec.label,
      sortable: spec.sortable,
    };
    if (!isUndefined(spec.width)) definition.width = spec.width;
    if (!isUndefined(spec.minWidth)) definition.minWidth = spec.minWidth;
    columns[spec.name] = tableColumn(definition);
  }

  const fieldByName = (name: string): DashboardField | undefined =>
    collection.fields.find((field) => field.name === name);
  const filterFields = (): DashboardField[] => collection.fields.filter((field) => field.readable);
  const sortableFields = (): DashboardField[] =>
    collection.fields.filter((field) => field.readable && field.kind === 'column');

  const data = ref<TableRow<TableColumns>[]>([]);
  const paginated = ref({ currentPage: state.page, lastPage: 1, perPage: PER_PAGE, total: 0 });
  const initialized = ref(false);
  const reload = ref(0);
  const selectable = ref(false);
  const selected = ref<Record<number | string, boolean>>({});
  const allSelected = ref(false);
  const selectAllState = ref<boolean | 'indeterminate'>(false);
  const selectedCount = computed(() =>
    allSelected.value
      ? paginated.value.total
      : Object.values(selected.value).filter(Boolean).length,
  );
  const filterOpen = ref(false);
  const sortingOpen = ref(false);
  let generation = 0;
  let deleteBusy = false;

  const refresh = (): void => {
    reload.value += 1;
  };

  const queryBody = (): Record<string, unknown> => {
    const body: Record<string, unknown> = {
      page: state.page,
      perPage: PER_PAGE,
      order: state.order,
    };
    if (!isUndefined(state.where)) body.where = state.where;
    // Read inside the load effect, so a content-language switch reloads the page at that locale.
    const locale = collection.translatable ? activeContentLocale() : undefined;
    if (!isUndefined(locale)) body.locale = locale;
    return body;
  };

  effect(() => {
    void reload.value;
    if (redirected) return;
    const mine = (generation += 1);
    void loadPage(segment, queryBody()).then((loaded) => {
      if (generation !== mine) return;
      if (!isUndefined(loaded)) {
        data.value = loaded.records.map(
          (record, index): TableRow<TableColumns> => ({
            ...record,
            id: isString(record.UUID) ? record.UUID : index,
          }),
        );
        paginated.value = {
          currentPage: loaded.page,
          lastPage: loaded.lastPage,
          perPage: loaded.perPage,
          total: loaded.total,
        };
        seedLabels(collection, loaded.records);
        deselectAll();
        if (loaded.page > loaded.lastPage) push({ page: loaded.lastPage || 1 }, true);
      }
      initialized.value = true;
    });
  });

  const sortValue = sortFromOrder(state.order);
  const sort: Ref<TableSort<TableColumns>> = {
    get value() {
      return sortValue as TableSort<TableColumns>;
    },
    set value(next) {
      if (next === null) return;
      const column = String(next.column);
      push({ page: 1, order: [next.direction === 'desc' ? `-${column}` : column] });
    },
  };

  const selectedBridge: Ref<Record<number | string, boolean>> = {
    get value() {
      return selected.value;
    },
    set value(next) {
      selected.value = next;
      refreshSelectable();
    },
  };

  function refreshSelectable(): void {
    if (Object.values(selected.value).some((value) => value)) {
      selectable.value = true;
      allSelected.value = allSelected.value && data.value.every((row) => selected.value[row.id]);
      selectAllState.value = allSelected.value
        ? true
        : data.value.every((row) => selected.value[row.id])
          ? paginated.value.lastPage === 1
            ? true
            : 'indeterminate'
          : false;
    } else {
      selectable.value = false;
      selectAllState.value = false;
    }
  }

  const select = (id: number | string): void => {
    selected.value = { ...selected.value, [id]: true };
    grid.selectOrigin.value = id;
    refreshSelectable();
  };

  const deselect = (id: number | string): void => {
    const next = { ...selected.value };
    delete next[id];
    selected.value = next;
    refreshSelectable();
  };

  const deselectAll = (): void => {
    selected.value = {};
    refreshSelectable();
  };

  const selectPage = (): void => {
    selected.value = Object.fromEntries(data.value.map((row) => [row.id, true]));
  };

  const onSelectAll = async (): Promise<void> => {
    if (selectAllState.value) {
      selected.value = {};
      allSelected.value = false;
      refreshSelectable();
    } else if (paginated.value.lastPage > 1) {
      const action = await openDialog({
        content: t('dashboard.table.selectPageOrAll', {
          perPage: data.value.length,
          total: paginated.value.total,
        }),
        actions: [
          { name: 'cancel', label: t('dashboard.cancel') },
          {
            name: 'page',
            label: t('dashboard.table.pageCount', { count: data.value.length }),
            variant: 'primary',
          },
          {
            name: 'all',
            label: t('dashboard.table.allCount', { count: paginated.value.total }),
            variant: 'primary',
          },
        ],
      });
      if (action === 'page') {
        selectPage();
        allSelected.value = false;
        refreshSelectable();
      } else if (action === 'all') {
        selectPage();
        allSelected.value = true;
        refreshSelectable();
      }
    } else {
      selectPage();
      allSelected.value = true;
      refreshSelectable();
    }
  };

  const onDelete = async (id: number | string): Promise<void> => {
    if (deleteBusy) return;
    const action = await openDialog({
      content: t('dashboard.table.confirmDeleteOne'),
      actions: [
        { name: 'cancel', label: t('dashboard.cancel') },
        { name: 'delete', label: t('dashboard.delete'), variant: 'destructive' },
      ],
    });
    if (action !== 'delete') return;
    deleteBusy = true;
    const gone = await deleteRecord(segment, String(id));
    deleteBusy = false;
    if (gone) {
      queueToast(t('dashboard.deleted', { count: 1 }), { type: 'success' });
      refresh();
    } else {
      toast(t('dashboard.deletedPartial', { count: 0, failed: 1 }), { type: 'error' });
    }
  };

  const allUUIDs = async (): Promise<string[]> => {
    const collected: string[] = [];
    for (let page = 1; ; page++) {
      const loaded = await loadPage(segment, { ...queryBody(), page });
      if (isUndefined(loaded)) break;
      for (const record of loaded.records) {
        if (isString(record.UUID)) collected.push(record.UUID);
      }
      if (page >= loaded.lastPage) break;
    }
    return collected;
  };

  const onDeleteSelection = async (): Promise<void> => {
    if (deleteBusy) return;
    const action = await openDialog({
      content: t('dashboard.table.confirmDeleteMany', { count: selectedCount.value }),
      actions: [
        { name: 'cancel', label: t('dashboard.cancel') },
        { name: 'delete', label: t('dashboard.delete'), variant: 'destructive' },
      ],
    });
    if (action !== 'delete') return;
    deleteBusy = true;
    const uuids = allSelected.value
      ? await allUUIDs()
      : Object.keys(selected.value).filter((id) => selected.value[id]);
    let lost = 0;
    for (const uuid of uuids) {
      if (!(await deleteRecord(segment, uuid))) lost += 1;
    }
    deleteBusy = false;
    if (lost === 0) {
      queueToast(t('dashboard.deleted', { count: uuids.length }), { type: 'success' });
    } else {
      toast(t('dashboard.deletedPartial', { count: uuids.length - lost, failed: lost }), {
        type: 'error',
      });
    }
    refresh();
  };

  const replaceRow = (id: number | string, record: TableRecord): void => {
    data.value = data.value.map((row) => (row.id === id ? { ...row, ...record, id } : row));
  };

  const rowHref = (id: number | string): string => `/collections/${segment}/${String(id)}`;

  const canEditField = (field: DashboardField): boolean =>
    canUpdate && field.writable && !field.immutable;

  const grid = table<TableColumns>({
    columns,
    data: () => data.value,
    sort,
    selectable: () => selectable.value,
    selected: selectedBridge,
    selectAllState: () => selectAllState.value,
    showEmptyState: () => initialized.value,
    labels: () => ({
      actions: t('dashboard.actions'),
      sortInAscendingOrder: t('dashboard.sort.ascending'),
      sortInDescendingOrder: t('dashboard.sort.descending'),
      selectAll:
        paginated.value.lastPage === 1
          ? t('dashboard.table.selectedCount', { count: selectedCount.value })
          : t('dashboard.table.selectedAcrossPages', {
              entryCount: selectedCount.value,
              pageCount: paginated.value.lastPage,
            }),
      selectAllIndeterminate: t('dashboard.table.selectedOnPage', {
        count: selectedCount.value,
      }),
      noData: t('dashboard.table.noData'),
    }),
    onSelectAll: () => void onSelectAll(),
    onDoubleClick: (row, event) => {
      const href = rowHref(row.id);
      if (event.ctrlKey || event.metaKey || event.shiftKey) window.open(href, '_blank');
      else navigate(href);
    },
    cell: (payload) => {
      const field = fieldByName(String(payload.key));
      if (isUndefined(field)) return h('div');
      return editableFieldCell(displayFor(field, payload.row as TableRecord), {
        cell: payload,
        collection,
        field,
        editable: canEditField(field) && isString(payload.row.id),
        onUpdated: (record) => replaceRow(payload.row.id, record),
      });
    },
    actions: ({ row, reference, close }) => {
      const href = rowHref(row.id);
      // The source's `pencil`, `list-search`, `trash-x`, `square-off`, and `checkbox` icons are
      // not in the icon registry yet; the nearest registered shapes stand in.
      const openItem = canUpdate
        ? dropdownItem([icon('pencil'), h('span', null, () => t('dashboard.edit'))], {
            href,
            onClick: () => close(),
          })
        : dropdownItem([icon('list-search'), h('span', null, () => t('dashboard.view'))], {
            href,
            onClick: () => close(),
          });
      openItem.title = t(canUpdate ? 'dashboard.edit' : 'dashboard.view');
      const deleteItem = canDelete
        ? dropdownItem([icon('trash-x'), h('span', null, () => t('dashboard.delete'))], {
            destructive: true,
            onClick: () => {
              close();
              void onDelete(row.id);
            },
          })
        : null;
      if (deleteItem) deleteItem.title = t('dashboard.delete');
      const menu = dropdown(
        [
          openItem,
          deleteItem,
          h('hr'),
          when(
            () => selected.value[row.id] === true,
            () => {
              const item = dropdownItem(
                [icon('square-off'), h('span', null, () => t('dashboard.deselect'))],
                {
                  onClick: () => {
                    close();
                    deselect(row.id);
                  },
                },
              );
              item.title = t('dashboard.deselect');
              return item;
            },
            () => {
              if (!canDelete) return null;
              const item = dropdownItem(
                [icon('checkbox'), h('span', null, () => t('dashboard.select'))],
                {
                  onClick: () => {
                    close();
                    select(row.id);
                  },
                },
              );
              item.title = t('dashboard.select');
              return item;
            },
          ),
        ],
        { reference, placement: 'end', size: -1, onClose: close },
      );
      return menu.root;
    },
  });

  const paginationEl = pagination({
    currentPage: () => paginated.value.currentPage,
    lastPage: () => paginated.value.lastPage,
    goToPageTitle: t('dashboard.pagination.goToPage'),
    nextPageTitle: t('dashboard.pagination.next'),
    previousPageTitle: t('dashboard.pagination.previous'),
    onChange: (page) => push({ page }),
    button: ({ currentPage, index, onClick }) => {
      const el = h(
        'button',
        {
          type: 'button',
          class:
            'ohne-pagination-button ohne-raw' +
            (currentPage === index ? ' ohne-pagination-button-active' : ''),
          onClick: () => onClick(),
        },
        index,
      );
      onCleanup(
        attachTooltip(el, () =>
          t('dashboard.pagination.showingRecords', {
            from: (index - 1) * paginated.value.perPage + 1,
            to: Math.min(index * paginated.value.perPage, paginated.value.total),
          }),
        ),
      );
      return el;
    },
  });

  // The source's `trash-x`, `adjustments`, and `note` icons are not in the icon registry yet.
  const deleteButton = (): HTMLElement => {
    const el = button(icon('trash-x'), {
      variant: 'destructive',
      onClick: () => void onDeleteSelection(),
    });
    onCleanup(
      attachTooltip(el, () => t('dashboard.table.deleteCount', { count: selectedCount.value })),
    );
    return el;
  };

  const filterButton = button(icon('adjustments'), {
    variant: whereDirty ? 'accent' : 'outline',
    bubble: whereDirty ? bubble() : undefined,
    onClick: () => {
      filterOpen.value = true;
    },
  });
  onCleanup(attachTooltip(filterButton, () => t('dashboard.filter.title')));

  const sortingButton = button(icon('arrows-sort'), {
    variant: 'outline',
    onClick: () => {
      sortingOpen.value = true;
    },
  });
  onCleanup(attachTooltip(sortingButton, () => t('dashboard.sort.title')));

  const newButton = canCreate
    ? button([h('span', null, () => t('dashboard.new')), icon('note')], {
        variant: 'primary',
        href: `/collections/${segment}/new`,
      })
    : null;

  const footer = h(
    'div',
    { class: 'o-collection-table-footer' },
    h(
      'div',
      { class: 'ohne-justify-between' },
      paginationEl,
      h(
        'div',
        { class: 'ohne-row ohne-ml-auto' },
        when(() => canDelete && selectable.value, deleteButton),
        filterButton,
        sortingButton,
        newButton,
      ),
    ),
  );

  const filterPopup = when(
    () => filterOpen.value,
    () => {
      let pending: ConditionObject | undefined;
      let apply = false;
      dataTablePopup({
        title: () => t('dashboard.filter.title'),
        fields: filterFields,
        where: state.where,
        onApply: (where) => {
          pending = where;
          apply = true;
        },
        onClose: (close) =>
          void close().then(() => {
            filterOpen.value = false;
            if (apply) push({ where: pending });
          }),
      });
      return null;
    },
  );

  const sortingPopup = when(
    () => sortingOpen.value,
    () => {
      const current = ref<string[]>([...state.order]);
      const baseline = JSON.stringify(state.order);
      const dirty = computed(() => JSON.stringify(current.value) !== baseline);
      let apply = false;

      const finish = (): void => {
        void handle.close().then(() => {
          sortingOpen.value = false;
          if (apply) push({ order: current.value });
        });
      };

      const guardedClose = (): void => {
        void (async () => {
          if (!dirty.value || ((await unsavedChanges.prompt?.()) ?? true)) finish();
        })();
      };

      const closeButton = button(icon('x'), {
        size: -2,
        variant: 'ghost',
        class: 'ohne-ml-auto',
        onClick: guardedClose,
      });
      effect(() => {
        closeButton.title = t('dashboard.close');
      });

      const applyButton = button(() => t('dashboard.apply'), {
        variant: 'outline',
        class: 'ohne-ml-auto',
        onClick: () => {
          apply = true;
          finish();
        },
      });
      effect(() => {
        const changed = dirty.value;
        applyButton.classList.toggle('ohne-button-primary', changed);
        applyButton.classList.toggle('ohne-button-outline', !changed);
      });

      const handle = popup(
        orderBy({
          model: () => current.value,
          fields: sortableFields,
          onCommit: (order) => {
            current.value = order;
          },
        }),
        {
          size: -1,
          width: '50rem',
          fullHeight: true,
          header: h(
            'div',
            { class: 'ohne-row' },
            h('span', { class: 'o-collection-table-title' }, () => t('dashboard.sort.title')),
            closeButton,
          ),
          footer: h('div', { class: 'ohne-justify-between' }, applyButton),
          onClose: () => guardedClose(),
        },
      );

      const hotkeys = useHotkeys({
        allowInOverlays: true,
        target: () => handle.root,
        listen: false,
      });
      setTimeout(() => {
        hotkeys.isListening.value = true;
        hotkeys.listen('save', (event) => {
          event.preventDefault();
          apply = true;
          finish();
        });
      });

      return null;
    },
  );

  const { listen } = useHotkeys();
  listen('selectAll', (event) => {
    if (canDelete && paginated.value.total > 0) {
      event.preventDefault();
      void onSelectAll();
    }
  });
  listen('delete', () => {
    if (canDelete && selectable.value) void onDeleteSelection();
  });

  const onArrowKey = (event: KeyboardEvent): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    if (hasModifierKey(event) || isEditingText() || overlayCount() > 0) return;
    const { currentPage, lastPage } = paginated.value;
    if (event.key === 'ArrowLeft' && currentPage > 1) {
      event.preventDefault();
      push({ page: currentPage - 1 });
    } else if (event.key === 'ArrowRight' && currentPage < lastPage) {
      event.preventDefault();
      push({ page: currentPage + 1 });
    }
  };
  window.addEventListener('keydown', onArrowKey);
  onCleanup(() => window.removeEventListener('keydown', onArrowKey));

  return h(
    'div',
    {
      class: () =>
        'o-collection-table' + (paginated.value.total === 0 ? ' o-collection-table-empty' : ''),
    },
    h('div', { tabindex: '-1', class: 'o-collection-table-scroller o-scrollbar' }, grid.root),
    footer,
    filterPopup,
    sortingPopup,
  );
}

/**
 * Loads one page through `POST /collections/[segment]/query`; a failure resolves `undefined`.
 */
async function loadPage(
  segment: string,
  body: Record<string, unknown>,
): Promise<QueryPage | undefined> {
  try {
    const response = await api(`POST /collections/${segment}/query`, {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) return undefined;
    return (await response.json()) as QueryPage;
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
function seedLabels(collection: DashboardCollection, records: readonly TableRecord[]): void {
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
 * The collection's first plain readable text field, the label heuristic the seeding shares with the sheet.
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
 * The cell's display content: system fields render specially, the rest through their field type.
 */
function displayFor(field: DashboardField, row: TableRecord): Child {
  if (field.name === '_updatedAt') {
    return () => {
      const value = row['_updatedAt'];
      if (!isNumber(value)) return dimMark('·');
      const language = useDashboardLanguage().value;
      const variant: DateVariant = isToday(value) ? 'time' : 'short';
      return h(
        'span',
        { class: 'ohne-truncate', title: dateFormat(language, 'full').format(value) },
        dateFormat(language, variant).format(value),
      );
    };
  }
  if (field.name === 'UUID') {
    return () => {
      const value = row['UUID'];
      if (!isString(value)) return dimMark('·');
      return h('span', { class: 'cell-mono cell-dim', title: value }, value.slice(0, 8));
    };
  }
  return fieldTypeFor(field).display({
    field,
    value: () => row[field.name],
    language: () => useDashboardLanguage().value,
  });
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

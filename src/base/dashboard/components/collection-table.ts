import {
  api,
  attachTooltip,
  bubble,
  button,
  type Child,
  countVerdicts,
  css,
  type DashboardCollection,
  type DashboardField,
  dashboardMeta,
  h,
  hasModifierKey,
  icon,
  isEditingText,
  keyed,
  lastNavigation,
  loadVerdicts,
  type MenuItem,
  navigate,
  openDialog,
  overlayCount,
  pagination,
  queueToast,
  type RouteContext,
  type RowVerdicts,
  signInCount,
  table,
  type TableColumn,
  type TableSort,
  toast,
  translateMessage,
  useHotkeys,
  useRoute,
  useT,
  when,
} from 'ohnejs/dashboard';
import {
  computed,
  type ConditionObject,
  deepEqual,
  effect,
  hasKey,
  hasRoute,
  isEmpty,
  isNull,
  isString,
  isUndefined,
  onCleanup,
  recordHref,
  type Ref,
  ref,
  sleep,
  stringifySearchParams,
  uniqueArray,
  untracked,
} from 'ohnejs/utils';

import { bookmarksPopup } from './bookmarks-popup.ts';
import { clearSelectionButton } from './clear-selection-button.ts';
import {
  columnFields,
  DEFAULT_ORDER,
  displayFor,
  droppedMessage,
  loadPage,
  loadTablePage,
  PER_PAGE,
  readableFields,
  rememberedView,
  rememberView,
  seedLabels,
  sortableFields,
  type TableRecord,
} from './collection-table-data.ts';
import {
  admitsRow,
  deletableRows,
  deletableSelection,
  pageUUIDs,
  selectAllStateOf,
  selectedCountOf,
} from './collection-table-selection.ts';
import {
  healView,
  parseTableState,
  resolveTableColumns,
  serializeTableColumns,
  serializeTableState,
  sortFromOrder,
  stripEditParam,
  type TableURLState,
} from './collection-table-state.ts';
import { columnsPopup } from './columns-popup.ts';
import { activeContentLocale } from './content-language-switcher.ts';
import { editableFieldCell } from './editable-field-cell.ts';
import { filterPopup } from './filter-popup.ts';
import { sortingPopup } from './sorting-popup.ts';
import { translationsCell, type TranslationsCellOptions } from './translations-cell.ts';
import { translationsPopup } from './translations-popup.ts';

const NO_VERDICTS: RowVerdicts = {
  update: new Set(),
  delete: new Set(),
  deleteTranslation: new Set(),
  select: undefined,
};

css`
  .o-collection-table {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .o-collection-table-footer {
    container-type: inline-size;
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
 * The collection table page body.
 *
 * The state lives in the URL: `page`, `order`, `where`, and `columns` are query params.
 * A reload or back and forward re-renders the same view.
 * The table rebuilds whenever the query changes, except for the `edit` param its cell popups own.
 * The last query string per segment is remembered.
 * It is restored whenever the query arrives bare, unless back or forward brought it.
 * A view part the query endpoint refuses is dropped with a toast, replacing the URL.
 * Every cell renders its field's display inside an editable cell whose popup patches only that field.
 * Sorting, the filter and sorting popups, and the pagination push new URL state.
 * A bookmarks button opens the saved views while the app serves their list route.
 * Rows select with shift ranges into the batch delete.
 * A row's actions menu opens, edits, and deletes single records behind confirm dialogs.
 * Each page loads with its row verdicts, so a row offers only what the `access` scopes admit for it.
 */
export function collectionTable(collection: DashboardCollection): Child {
  const route = untracked(useRoute);
  const query = (): RouteContext['query'] => route?.query ?? {};
  effect(() => {
    const remembered = rememberedView(collection);
    if (isEmpty(query()) && remembered !== '' && lastNavigation() !== 'popstate') {
      navigate(location.pathname + remembered, { replace: true });
    }
  });
  const search = (): string => stripEditParam(`?${stringifySearchParams(query())}`);
  return keyed(search, () => tableView(collection, search()));
}

/**
 * The table for `search`, the query without `edit`, with its toolbar, footer, and popups.
 */
function tableView(collection: DashboardCollection, search: string): HTMLElement {
  const t = useT();
  const segment = collection.segment;
  const canCreate = collection.operations.create?.allowed === true;
  const deleteScoped = collection.operations.delete?.scoped === true;
  const meta = untracked(dashboardMeta);
  const canTranslate = collection.translatable && (meta?.locales.length ?? 0) > 1;
  const canBookmark = hasRoute(meta?.routes ?? [], 'GET /dashboard/bookmarks/[collection]');

  rememberView(segment, search);

  const state = parseTableState(search, DEFAULT_ORDER);
  const whereDirty = !isUndefined(state.where);
  const orderDirty = state.order.join(',') !== DEFAULT_ORDER.join(',');

  const push = (patch: Partial<TableURLState>, replace = false): void => {
    const next: TableURLState = {
      page: patch.page ?? state.page,
      order: patch.order ?? state.order,
      where: hasKey(patch, 'where') ? patch.where : state.where,
      columns: hasKey(patch, 'columns') ? patch.columns : state.columns,
    };
    const query = serializeTableState(next, DEFAULT_ORDER, search);
    const target = query === '' ? '' : `?${query}`;
    rememberView(segment, target);
    navigate(location.pathname + target, { replace });
  };

  const declared = collection.table?.columns;
  const source = isUndefined(state.columns) || isEmpty(state.columns) ? declared : state.columns;
  const fields = columnFields(collection);
  const specs = resolveTableColumns(fields, source);
  const defaultEntries = serializeTableColumns(resolveTableColumns(fields, declared));
  const currentEntries = serializeTableColumns(specs);
  const columnsDirty = !deepEqual(currentEntries, defaultEntries);
  const view = serializeTableState(
    { ...state, page: 1, columns: columnsDirty ? currentEntries : undefined },
    DEFAULT_ORDER,
  );

  const data = ref<TableRecord[] | undefined>(undefined);
  const verdicts = ref(NO_VERDICTS);
  const paginated = ref({ currentPage: state.page, lastPage: 1, perPage: PER_PAGE, total: 0 });
  const reload = ref(0);
  const selected = ref<ReadonlySet<number | string>>(new Set());
  const allSelected = ref(false);
  const allCount = ref(0);
  const selectedCount = computed(() =>
    selectedCountOf(selected.value, allSelected.value, allCount.value),
  );
  const filterOpen = ref(false);
  const columnsOpen = ref(false);
  const sortingOpen = ref(false);
  const bookmarksOpen = ref(false);
  const translationsUUID = ref<string | null>(null);
  let generation = 0;
  let deleteBusy = false;
  let countBusy = false;

  const refresh = (): void => {
    reload.value += 1;
  };

  const activeLocale = (): string | undefined =>
    collection.translatable ? activeContentLocale() : undefined;

  const queryBody = (locale: string | undefined): Record<string, unknown> => {
    const body: Record<string, unknown> = {
      // The explicit `UUID` keeps the row identity when it is not a visible column.
      select: uniqueArray(['UUID', ...specs.map((spec) => spec.name)]),
      page: state.page,
      perPage: PER_PAGE,
      order: state.order,
    };
    if (!isUndefined(state.where)) body.where = state.where;
    if (!isUndefined(locale)) body.locale = locale;
    return body;
  };

  effect(() => {
    void reload.value;
    // A sign-in in place refetches the page an expired session failed to load.
    void signInCount();
    const mine = (generation += 1);
    // Read inside the load effect, so a content-language switch reloads the page at that locale.
    const locale = activeLocale();
    void loadTablePage(segment, queryBody(locale)).then(async (loaded) => {
      if (generation !== mine) return;
      if (isUndefined(loaded) || 'refused' in loaded) {
        const patch = isUndefined(loaded)
          ? undefined
          : healView(state, loaded.refused, DEFAULT_ORDER);
        if (!isUndefined(patch)) {
          toast(t(droppedMessage(patch)), { type: 'warning' });
          push(patch, true);
          return;
        }
        data.value ??= [];
      } else {
        const answered = await loadVerdicts(collection, pageUUIDs(loaded.records), locale);
        if (generation !== mine) return;
        data.value = loaded.records;
        paginated.value = {
          currentPage: loaded.page,
          lastPage: loaded.lastPage,
          perPage: loaded.perPage,
          total: loaded.total,
        };
        verdicts.value = answered;
        seedLabels(collection, loaded.records, locale);
        deselectAll();
        if (loaded.page > loaded.lastPage) push({ page: loaded.lastPage || 1 }, true);
      }
    });
  });

  // Drops the in-flight answers of a table the user has left.
  onCleanup(() => {
    generation += 1;
  });

  const sortValue = sortFromOrder(state.order);
  const sort: Ref<TableSort | null> = {
    get value() {
      return sortValue;
    },
    set value(next) {
      if (isNull(next)) return;
      push({ page: 1, order: [next.direction === 'desc' ? `-${next.column}` : next.column] });
    },
  };

  const deletable = (): TableRecord[] => deletableRows(data.value ?? [], verdicts.value.delete);

  const selectAllState = computed(() =>
    selectAllStateOf(deletable(), selected.value, allSelected.value, paginated.value.lastPage),
  );

  /**
   * Writes the selection the `deletable` verdict admits, and leaves every-page mode once a page row drops.
   */
  const setSelected = (next: ReadonlySet<number | string>): void => {
    selected.value = deletableSelection(next, verdicts.value.delete);
    allSelected.value = allSelected.value && selectAllState.value === true;
  };

  const selectedBridge: Ref<ReadonlySet<number | string>> = {
    get value() {
      return selected.value;
    },
    set value(next) {
      setSelected(next);
    },
  };

  const select = (uuid: string): void => setSelected(new Set(selected.value).add(uuid));

  const deselect = (uuid: string): void => {
    const next = new Set(selected.value);
    next.delete(uuid);
    setSelected(next);
  };

  const deselectAll = (): void => setSelected(new Set());

  const selectPage = (): void => setSelected(new Set(pageUUIDs(deletable())));

  const deletableTotal = async (): Promise<number> => {
    const counts = deleteScoped
      ? await countVerdicts(collection, state.where, activeLocale())
      : undefined;
    return counts?.delete ?? paginated.value.total;
  };

  const onSelectAll = async (): Promise<void> => {
    const perPage = deletable().length;
    if (perPage === 0 || countBusy) return;
    if (selectAllState.value) {
      allSelected.value = false;
      deselectAll();
    } else if (paginated.value.lastPage > 1) {
      const mine = generation;
      countBusy = true;
      const total = await deletableTotal();
      countBusy = false;
      if (generation !== mine) return;
      const action = await openDialog({
        content: t('dashboard.table.selectPageOrAll', { perPage, total }),
        actions: [
          { name: 'cancel', label: t('dashboard.cancel') },
          {
            name: 'page',
            label: t('dashboard.table.pageCount', { count: perPage }),
            variant: 'primary',
          },
          {
            name: 'all',
            label: t('dashboard.table.allCount', { count: total }),
            variant: 'primary',
          },
        ],
      });
      if (action === 'page') {
        allSelected.value = false;
        selectPage();
      } else if (action === 'all') {
        selectPage();
        allCount.value = total;
        allSelected.value = true;
      }
    } else {
      selectPage();
      allCount.value = perPage;
      allSelected.value = true;
    }
  };

  const onDelete = async (uuid: string): Promise<void> => {
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
    const gone = await deleteRecord(segment, uuid);
    deleteBusy = false;
    if (gone) {
      queueToast(t('dashboard.deleted', { count: 1 }), { type: 'success' });
    } else {
      toast(t('dashboard.deletedPartial', { count: 0, failed: 1 }), { type: 'error' });
    }
    refresh();
  };

  const allUUIDs = async (): Promise<string[]> => {
    const collected: string[] = [];
    const locale = activeLocale();
    for (let page = 1; ; page++) {
      const loaded = await loadPage(segment, { ...queryBody(locale), page });
      if (isUndefined(loaded)) break;
      const uuids = pageUUIDs(loaded.records);
      if (deleteScoped) {
        const answered = await loadVerdicts(collection, uuids, locale);
        collected.push(...uuids.filter((uuid) => answered.delete.has(uuid)));
      } else {
        collected.push(...uuids);
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
    const uuids = allSelected.value ? await allUUIDs() : [...selected.value].filter(isString);
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

  const replaceRow = (uuid: string, record: TableRecord): void => {
    data.value = data.value?.map((row) => (row.UUID === uuid ? { ...row, ...record } : row));
  };

  const rowHref = (uuid: unknown): string => recordHref(collection, String(uuid));

  const mayUpdate = (uuid: unknown): boolean => admitsRow(verdicts.value.update, uuid);

  const mayDelete = (uuid: unknown): boolean => admitsRow(verdicts.value.delete, uuid);

  // A gated field edits in the record editor, where the gate reads the whole record.
  const canEditField = (field: DashboardField, uuid: unknown): boolean =>
    mayUpdate(uuid) &&
    field.writable &&
    !field.immutable &&
    isUndefined(field.when) &&
    (verdicts.value.select?.includes(field.name) ?? true);

  const fieldCell = (field: DashboardField, row: TableRecord): HTMLElement => {
    const rowID = String(row.UUID);
    if (field.name === '_translations') {
      const chips: TranslationsCellOptions = { canUpdate: mayUpdate(row.UUID) };
      if (isString(row.UUID))
        chips.href = (code) => recordHref(collection, rowID, { locale: code });
      return editableFieldCell(translationsCell(row, chips), {
        record: row,
        rowID,
        collection,
        field,
        editable: false,
        action: {
          icon: 'language',
          tooltip: () => t('dashboard.translations.translate'),
          onClick: () => {
            translationsUUID.value = rowID;
          },
        },
      });
    }
    return editableFieldCell(displayFor(field, row), {
      record: row,
      rowID,
      collection,
      field,
      editable: canEditField(field, row.UUID),
      onUpdated: (record) => replaceRow(rowID, record),
    });
  };

  const columns: Record<string, TableColumn<TableRecord>> = {};
  for (const spec of specs) {
    const field = fields.find((entry) => entry.name === spec.name);
    columns[spec.name] = {
      label: () => translateMessage(spec.label),
      sortable: spec.sortable,
      width: spec.width,
      minWidth: spec.minWidth,
      render: (row) => (isUndefined(field) ? null : fieldCell(field, row)),
    };
  }

  const rowActions = (row: TableRecord): MenuItem[] => {
    const uuid = String(row.UUID);
    const canDelete = mayDelete(row.UUID);
    const items: MenuItem[] = [
      mayUpdate(row.UUID)
        ? { label: 'dashboard.edit', icon: 'pencil', href: rowHref(uuid) }
        : { label: 'dashboard.view', icon: 'list-search', href: rowHref(uuid) },
    ];
    if (canTranslate) {
      items.push({
        label: 'dashboard.translations.translate',
        icon: 'language',
        onSelect: () => {
          translationsUUID.value = uuid;
        },
      });
    }
    if (canDelete) {
      items.push({
        label: 'dashboard.delete',
        icon: 'trash-x',
        destructive: true,
        onSelect: () => void onDelete(uuid),
      });
    }
    items.push('---');
    if (selected.value.has(uuid)) {
      items.push({
        label: 'dashboard.deselect',
        icon: 'square-off',
        onSelect: () => deselect(uuid),
      });
    } else if (canDelete) {
      items.push({ label: 'dashboard.select', icon: 'checkbox', onSelect: () => select(uuid) });
    }
    return items;
  };

  const grid = table(() => data.value, {
    key: (row, index) => (isString(row.UUID) ? row.UUID : index),
    columns,
    sort,
    serverSort: true,
    fixed: true,
    selection: {
      selected: selectedBridge,
      selectable: (row) => mayDelete(row.UUID),
      checkboxes: () => selected.value.size > 0,
      all: {
        state: () => selectAllState.value,
        toggle: () => onSelectAll(),
        label: () => {
          const state = selectAllState.value;
          if (state === false) return '';
          if (state === 'indeterminate') {
            return t('dashboard.table.selectedOnPage', { count: selectedCount.value });
          }
          return paginated.value.lastPage === 1
            ? t('dashboard.table.selectedCount', { count: selectedCount.value })
            : t('dashboard.table.selectedAcrossPages', {
                entryCount: selectedCount.value,
                pageCount: paginated.value.lastPage,
              });
        },
      },
    },
    href: (row) => rowHref(row.UUID),
    actions: rowActions,
  });

  const paginationEl = pagination({
    currentPage: () => paginated.value.currentPage,
    lastPage: () => paginated.value.lastPage,
    goToPageTitle: () => t('dashboard.pagination.goToPage'),
    nextPageTitle: () => t('dashboard.pagination.next'),
    previousPageTitle: () => t('dashboard.pagination.previous'),
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

  const deleteButton = (): HTMLElement =>
    button(() => t('dashboard.table.deleteCount', { count: selectedCount.value }), {
      icon: 'trash-x',
      iconOnly: true,
      variant: 'destructive',
      onClick: () => void onDeleteSelection(),
    });

  const clearButton = (): HTMLElement =>
    clearSelectionButton(() => selectedCount.value, deselectAll);

  const bookmarksButton = canBookmark
    ? button(() => t('dashboard.bookmarks.title'), {
        icon: 'bookmark',
        iconOnly: true,
        variant: 'outline',
        onClick: () => {
          bookmarksOpen.value = true;
        },
      })
    : null;

  const filterButton = button(() => t('dashboard.filter.title'), {
    icon: 'adjustments',
    iconOnly: true,
    variant: whereDirty ? 'accent' : 'outline',
    bubble: whereDirty ? bubble() : undefined,
    onClick: () => {
      filterOpen.value = true;
    },
  });

  const columnsButton = button(() => t('dashboard.columns.title'), {
    icon: 'layout-columns',
    iconOnly: true,
    variant: columnsDirty ? 'accent' : 'outline',
    bubble: columnsDirty ? bubble() : undefined,
    onClick: () => {
      columnsOpen.value = true;
    },
  });

  const sortingButton = button(() => t('dashboard.sort.title'), {
    icon: 'arrows-sort',
    iconOnly: true,
    variant: orderDirty ? 'accent' : 'outline',
    bubble: orderDirty ? bubble() : undefined,
    onClick: () => {
      sortingOpen.value = true;
    },
  });

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
        when(
          () => selected.value.size > 0,
          () => [deleteButton(), clearButton()],
        ),
        bookmarksButton,
        filterButton,
        columnsButton,
        sortingButton,
        newButton,
      ),
    ),
  );

  const filterHost = when(
    () => filterOpen.value,
    () => {
      let pending: ConditionObject | undefined;
      let apply = false;
      filterPopup({
        title: () => t('dashboard.filter.title'),
        fields: () => readableFields(collection),
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

  const columnsHost = when(
    () => columnsOpen.value,
    () => {
      let pending: string[] | undefined;
      let apply = false;
      columnsPopup({
        fields: () => readableFields(collection),
        current: currentEntries,
        defaults: defaultEntries,
        onApply: (columns) => {
          pending = columns;
          apply = true;
        },
        onClose: (close) =>
          void close().then(() => {
            columnsOpen.value = false;
            if (apply) push({ columns: pending });
          }),
      });
      return null;
    },
  );

  const sortingHost = when(
    () => sortingOpen.value,
    () => {
      let pending: string[] = [];
      let apply = false;
      sortingPopup({
        fields: () => sortableFields(collection),
        order: state.order,
        defaults: DEFAULT_ORDER,
        onApply: (order) => {
          pending = order;
          apply = true;
        },
        onClose: (close) =>
          void close().then(() => {
            sortingOpen.value = false;
            if (apply) push({ order: pending });
          }),
      });
      return null;
    },
  );

  const bookmarksHost = when(
    () => bookmarksOpen.value,
    () => {
      let pending: string | undefined;
      bookmarksPopup({
        collection,
        view,
        onApply: (next) => {
          pending = next;
        },
        onClose: (close) =>
          void close().then(() => {
            bookmarksOpen.value = false;
            if (!isUndefined(pending))
              push({ ...parseTableState(pending, DEFAULT_ORDER), page: 1 });
          }),
      });
      return null;
    },
  );

  const translationsHost = when(
    () => !isNull(translationsUUID.value),
    () => {
      const uuid = translationsUUID.value;
      if (isNull(uuid)) return null;
      translationsPopup({
        collection,
        uuid,
        currentlyEditing: () => t('dashboard.translations.selected'),
        showEditCurrent: true,
        onCopied: () => refresh(),
        onDeleted: () => refresh(),
        onClose: (close) =>
          void close().then(() => {
            translationsUUID.value = null;
          }),
      });
      return null;
    },
  );

  const { listen } = useHotkeys();
  listen('selectAll', (event) => {
    if (deletable().length > 0) {
      event.preventDefault();
      void onSelectAll();
    }
  });
  listen('delete', () => {
    if (selected.value.size > 0) void onDeleteSelection();
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
    { class: 'o-collection-table' },
    grid,
    footer,
    filterHost,
    columnsHost,
    sortingHost,
    bookmarksHost,
    translationsHost,
  );
}

/**
 * Deletes one record, retrying once on a busy `503`, and resolves whether the delete landed.
 * A `404` is a row outside the caller's delete scope as often as a vanished one, so it never counts.
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

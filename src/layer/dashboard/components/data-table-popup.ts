import {
  attachTooltip,
  bubble,
  button,
  css,
  type DashboardCollection,
  dropdown,
  dropdownItem,
  h,
  hasModifierKey,
  icon,
  type IconName,
  isEditingText,
  overlayCount,
  pagination,
  popup,
  type Popup,
  registerRecordPicker,
  type Table,
  type TableColumns,
  type TableRow,
  type TableSort,
  table,
  tableColumn,
  useHotkeys,
  useT,
  when,
} from 'ohne/dashboard';
import {
  computed,
  type ConditionObject,
  deepEqual,
  effect,
  hasKey,
  isEmpty,
  isNull,
  isString,
  isUndefined,
  nextTick,
  onCleanup,
  type Ref,
  ref,
  uniqueArray,
  untracked,
} from 'ohne/utils';

import {
  columnFields,
  DEFAULT_ORDER,
  displayFor,
  loadPage,
  PER_PAGE,
  readableFields,
  seedLabels,
  sortableFields,
  tableMemory,
  type TableRecord,
} from './collection-table-data.ts';
import {
  orderedSelection,
  parseTableState,
  resolveTableColumns,
  serializeTableColumns,
  sortFromOrder,
  type TableColumnSpec,
  type TableURLState,
} from './collection-table-state.ts';
import { columnsPopup } from './columns-popup.ts';
import { activeContentLocale } from './content-language-switcher.ts';
import { filterPopup } from './filter-popup.ts';
import { sortingPopup } from './sorting-popup.ts';

/**
 * Options for `dataTablePopup`.
 */
export interface DataTablePopupOptions {
  /**
   * The readable collection whose records the popup browses.
   */
  collection: DashboardCollection;

  /**
   * The popup title, read reactively when given as a getter.
   */
  title: string | (() => string);

  /**
   * The currently linked record `UUID`s, seeding the selection.
   */
  values: readonly string[];

  /**
   * Whether rows select many with checkboxes; `false` picks exactly one and closes.
   *
   * @default
   * false
   */
  multiple?: boolean;

  /**
   * Called with the picked `UUID`s: retained values in their given order, then new picks in pick order.
   */
  onApply(uuids: string[]): void;

  /**
   * Called when the popup asks to close, with its animated close function.
   * The caller awaits it and then disposes the region that created the popup.
   */
  onClose(close: () => Promise<void>): void;
}

const pickerMemory = new Map<string, TableURLState>();

css`
  .o-data-table-popup-title {
    font-weight: 500;
  }

  .o-data-table-popup .ohne-popup-content .ohne-container-content {
    height: 100%;
  }

  .o-data-table-popup-body {
    height: 100%;
  }

  .o-data-table-popup-empty .ohne-table {
    min-height: 100%;
  }

  .o-data-table-popup .ohne-table-select-all {
    display: none;
  }

  .o-data-table-popup .ohne-table-cell-active-actions .ohne-dropdown {
    max-width: none;
  }

  .o-data-table-popup-cell {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    min-height: 1.5rem;
  }
`;

/**
 * The record picker: a full collection table inside a popup, for linking records by browsing.
 *
 * The table pages, sorts by its headers, and configures through the filter, columns, and sorting popups.
 * Its view state is remembered per collection; the first open seeds from the collection page's own view.
 * Single mode picks on double-click or the row's Select action and closes.
 * Multiple mode selects with checkboxes and shift ranges across pages, and applies explicitly.
 * A row's actions also open the record in a new tab, as edit or view by the update permission.
 * Cmd/Ctrl+S applies or closes, Cmd/Ctrl+A toggles the page's selection, and arrow keys page.
 * Create it inside a reactive region; dispose the region after `onClose`'s close resolves.
 */
export function dataTablePopup(options: DataTablePopupOptions): Popup {
  const t = useT();
  const collection = options.collection;
  const segment = collection.segment;
  const multiple = options.multiple ?? false;
  const canUpdate = collection.operations.update?.allowed === true;

  const state = pickerState(collection);
  const revision = ref(0);
  const columnsRevision = ref(0);
  let scrollTop = false;

  const push = (patch: Partial<TableURLState>): void => {
    if (!isUndefined(patch.page)) state.page = patch.page;
    // An emptied order falls back to the default, exactly as `parseTableState` reads one.
    if (!isUndefined(patch.order)) {
      state.order = isEmpty(patch.order) ? [...DEFAULT_ORDER] : patch.order;
    }
    if (hasKey(patch, 'where')) state.where = patch.where;
    if (hasKey(patch, 'columns')) state.columns = patch.columns;
    pickerMemory.set(segment, cloneState(state));
    scrollTop = true;
    revision.value += 1;
    if (hasKey(patch, 'columns')) columnsRevision.value += 1;
  };

  const declared = collection.table?.columns;
  const fields = columnFields(collection);
  const defaultEntries = serializeTableColumns(resolveTableColumns(fields, declared));
  const specs = (): TableColumnSpec[] => {
    const source = isUndefined(state.columns) || isEmpty(state.columns) ? declared : state.columns;
    return resolveTableColumns(fields, source);
  };

  const whereDirty = computed(() => {
    void revision.value;
    return !isUndefined(state.where);
  });
  const orderDirty = computed(() => {
    void revision.value;
    return state.order.join(',') !== DEFAULT_ORDER.join(',');
  });
  const columnsDirty = computed(() => {
    void revision.value;
    return !deepEqual(serializeTableColumns(specs()), defaultEntries);
  });

  const data = ref<TableRow<TableColumns>[]>([]);
  const paginated = ref({ currentPage: state.page, lastPage: 1, perPage: PER_PAGE, total: 0 });
  const initialized = ref(false);
  const filterOpen = ref(false);
  const columnsOpen = ref(false);
  const sortingOpen = ref(false);
  let generation = 0;

  const queryBody = (): Record<string, unknown> => {
    const body: Record<string, unknown> = {
      // The explicit `UUID` keeps the row identity when it is not a visible column.
      select: uniqueArray(['UUID', ...specs().map((spec) => spec.name)]),
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
    void revision.value;
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
        if (loaded.page > loaded.lastPage) push({ page: loaded.lastPage || 1 });
      }
      initialized.value = true;
      if (scrollTop) {
        scrollTop = false;
        handle.content.scrollTo({ top: 0, behavior: 'instant' });
      }
    });
  });

  const sort: Ref<TableSort<TableColumns>> = {
    get value() {
      void revision.value;
      return sortFromOrder(state.order) as TableSort<TableColumns>;
    },
    set value(next) {
      if (isNull(next)) return;
      const column = String(next.column);
      push({ page: 1, order: [next.direction === 'desc' ? `-${column}` : column] });
    },
  };

  const selected = ref<Record<number | string, boolean>>(
    Object.fromEntries(options.values.map((uuid) => [uuid, true])),
  );
  let ordered: string[] = [...options.values];
  const selectedBridge: Ref<Record<number | string, boolean>> = {
    get value() {
      return selected.value;
    },
    set value(next) {
      ordered = orderedSelection(ordered, next);
      selected.value = next;
    },
  };
  const selectedCount = computed(() => Object.values(selected.value).filter(Boolean).length);
  const selectionChanged = computed(() => {
    const current = Object.entries(selected.value)
      .filter(([, on]) => on)
      .map(([uuid]) => uuid)
      .sort();
    return !deepEqual(current, [...options.values].sort());
  });

  const select = (id: number | string): void => {
    selectedBridge.value = { ...selected.value, [id]: true };
    if (!isUndefined(grid)) grid.selectOrigin.value = id;
  };

  const deselect = (id: number | string): void => {
    const next = { ...selected.value };
    delete next[id];
    selectedBridge.value = next;
  };

  const togglePage = (): void => {
    const rows = data.value;
    const all = rows.every((row) => selected.value[row.id] === true);
    const next = { ...selected.value };
    for (const row of rows) {
      if (all) delete next[row.id];
      else next[row.id] = true;
    }
    selectedBridge.value = next;
  };

  const pick = (id: number | string): void => {
    options.onApply([String(id)]);
    options.onClose(handle.close);
  };

  const applySelection = (): void => {
    options.onApply([...ordered]);
    options.onClose(handle.close);
  };

  let grid: Table | undefined;

  const buildGrid = (): HTMLElement => {
    const columns: TableColumns = {};
    for (const spec of specs()) {
      const definition: Parameters<typeof tableColumn>[0] = {
        label: spec.label,
        sortable: spec.sortable,
      };
      if (!isUndefined(spec.width)) definition.width = spec.width;
      if (!isUndefined(spec.minWidth)) definition.minWidth = spec.minWidth;
      columns[spec.name] = tableColumn(definition);
    }
    grid = table<TableColumns>({
      columns,
      data: () => data.value,
      sort,
      selectable: () => multiple,
      selected: selectedBridge,
      showEmptyState: () => initialized.value,
      labels: () => ({
        actions: t('dashboard.actions'),
        sortInAscendingOrder: t('dashboard.sort.ascending'),
        sortInDescendingOrder: t('dashboard.sort.descending'),
        noData: t('dashboard.table.noData'),
      }),
      onDoubleClick: (row) => {
        if (multiple) select(row.id);
        else pick(row.id);
      },
      cell: (payload) => {
        const field = collection.fields.find((entry) => entry.name === String(payload.key));
        if (isUndefined(field)) return h('div');
        return h(
          'div',
          { class: 'o-data-table-popup-cell' },
          displayFor(field, payload.row as TableRecord),
        );
      },
      actions: ({ row, reference, close }) => {
        const selectItem = (): HTMLElement => {
          const item = dropdownItem(
            [icon('checkbox'), h('span', null, () => t('dashboard.select'))],
            {
              onClick: () => {
                close();
                if (multiple) select(row.id);
                else pick(row.id);
              },
            },
          );
          item.title = t('dashboard.select');
          return item;
        };
        const deselectItem = (): HTMLElement => {
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
        };
        const openItem = dropdownItem(
          [
            icon(canUpdate ? 'pencil' : 'list-search'),
            h('span', null, () => t(canUpdate ? 'dashboard.edit' : 'dashboard.view')),
          ],
          {
            href: `/collections/${segment}/${String(row.id)}`,
            target: '_blank',
            onClick: () => close(),
          },
        );
        openItem.title = t(canUpdate ? 'dashboard.edit' : 'dashboard.view');
        const menu = dropdown(
          [
            when(() => multiple && selected.value[row.id] === true, deselectItem, selectItem),
            h('hr'),
            openItem,
          ],
          { reference, placement: 'end', size: -1, onClose: close },
        );
        return menu.root;
      },
    });
    return grid.root;
  };

  const paginationEl = pagination({
    currentPage: () => paginated.value.currentPage,
    lastPage: () => paginated.value.lastPage,
    goToPageTitle: untracked(() => t('dashboard.pagination.goToPage')),
    nextPageTitle: untracked(() => t('dashboard.pagination.next')),
    previousPageTitle: untracked(() => t('dashboard.pagination.previous')),
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

  const viewButton = (
    glyph: IconName,
    dirty: () => boolean,
    tooltip: () => string,
    onClick: () => void,
  ): HTMLElement => {
    const el = button(icon(glyph), {
      variant: 'outline',
      bubble: () => (dirty() ? bubble() : null),
      onClick,
    });
    effect(() => {
      const changed = dirty();
      el.classList.toggle('ohne-button-accent', changed);
      el.classList.toggle('ohne-button-outline', !changed);
    });
    onCleanup(attachTooltip(el, tooltip));
    return el;
  };

  const filterButton = viewButton(
    'adjustments',
    () => whereDirty.value,
    () => t('dashboard.filter.title'),
    () => {
      filterOpen.value = true;
    },
  );
  const columnsButton = viewButton(
    'layout-columns',
    () => columnsDirty.value,
    () => t('dashboard.columns.title'),
    () => {
      columnsOpen.value = true;
    },
  );
  const sortingButton = viewButton(
    'arrows-sort',
    () => orderDirty.value,
    () => t('dashboard.sort.title'),
    () => {
      sortingOpen.value = true;
    },
  );

  const actionButton = multiple
    ? button(() => t('dashboard.applyCount', { count: selectedCount.value }), {
        variant: 'outline',
        onClick: applySelection,
      })
    : button(() => t('dashboard.close'), {
        variant: 'outline',
        onClick: () => options.onClose(handle.close),
      });
  if (multiple) {
    effect(() => {
      const changed = selectionChanged.value;
      actionButton.classList.toggle('ohne-button-primary', changed);
      actionButton.classList.toggle('ohne-button-outline', !changed);
    });
  }

  const closeButton = button(icon('x'), {
    size: -2,
    variant: 'ghost',
    class: 'ohne-ml-auto',
    onClick: () => options.onClose(handle.close),
  });
  effect(() => {
    closeButton.title = t('dashboard.close');
  });

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
        current: serializeTableColumns(specs()),
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

  const body = h(
    'div',
    {
      class: () =>
        'o-data-table-popup-body' +
        (initialized.value && paginated.value.total === 0 ? ' o-data-table-popup-empty' : ''),
    },
    () => {
      void columnsRevision.value;
      return buildGrid();
    },
    filterHost,
    columnsHost,
    sortingHost,
  );

  const onArrowKey = (event: KeyboardEvent): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    if (hasModifierKey(event) || isEditingText() || overlayCount() !== depth) return;
    const { currentPage, lastPage } = paginated.value;
    if (event.key === 'ArrowLeft' && currentPage > 1) {
      event.preventDefault();
      push({ page: currentPage - 1 });
    } else if (event.key === 'ArrowRight' && currentPage < lastPage) {
      event.preventDefault();
      push({ page: currentPage + 1 });
    }
  };

  const handle = popup(body, {
    size: -1,
    width: '80rem',
    fullHeight: true,
    additionalClasses: ['ohne-popup-no-padding', 'o-data-table-popup'],
    header: h(
      'div',
      { class: 'ohne-row' },
      h('span', { class: 'o-data-table-popup-title' }, options.title),
      closeButton,
    ),
    footer: h(
      'div',
      { class: 'ohne-justify-between' },
      paginationEl,
      h(
        'div',
        { class: 'ohne-row ohne-ml-auto' },
        filterButton,
        columnsButton,
        sortingButton,
        actionButton,
      ),
    ),
    onClose: () => options.onClose(handle.close),
    onKeydown: onArrowKey,
  });

  // Pinned like a hotkey instance, so arrows go dead while a popup or dropdown sits above.
  let depth = -1;
  void nextTick().then(() => {
    setTimeout(() => {
      depth = overlayCount();
    });
  });

  const hotkeys = useHotkeys({ allowInOverlays: true, target: () => handle.root, listen: false });
  setTimeout(() => {
    hotkeys.isListening.value = true;
    hotkeys.listen('selectAll', (event) => {
      if (multiple) {
        event.preventDefault();
        togglePage();
      }
    });
    hotkeys.listen('save', (event) => {
      event.preventDefault();
      if (multiple) applySelection();
      else options.onClose(handle.close);
    });
  });

  return handle;
}

/**
 * The popup's starting view state for the collection: its own remembered view, or a fresh seed.
 * A fresh seed reads the collection page's own remembered view, back on page one.
 * Always a private copy, so stacked pickers of one collection never mutate each other's state.
 */
function pickerState(collection: DashboardCollection): TableURLState {
  const remembered = pickerMemory.get(collection.segment);
  if (!isUndefined(remembered)) return cloneState(remembered);
  const state = parseTableState(tableMemory.get(collection.segment) ?? '', DEFAULT_ORDER);
  state.page = 1;
  return state;
}

/**
 * A copy of the state whose lists are the copy's own; the `where` is replaced wholesale, never mutated.
 */
function cloneState(state: TableURLState): TableURLState {
  return {
    page: state.page,
    order: [...state.order],
    where: state.where,
    columns: isUndefined(state.columns) ? undefined : [...state.columns],
  };
}

registerRecordPicker((request) => {
  dataTablePopup({
    collection: request.target,
    title: request.field.label,
    values: request.values,
    multiple: request.multiple,
    onApply: request.onApply,
    onClose: (close) => void close().then(request.onClose),
  });
});

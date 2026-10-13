import {
  attachTooltip,
  bubble,
  button,
  css,
  type DashboardCollection,
  h,
  hasModifierKey,
  type IconName,
  isEditingText,
  loadVerdicts,
  type MenuItem,
  overlayCount,
  pagination,
  popup,
  type Popup,
  registerRecordPicker,
  table,
  type TableColumn,
  type TableSort,
  toast,
  translateMessage,
  useHotkeys,
  useT,
  when,
} from 'ohnejs/dashboard';
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
  recordHref,
  type Ref,
  ref,
  uniqueArray,
} from 'ohnejs/utils';

import {
  columnFields,
  DEFAULT_ORDER,
  displayFor,
  droppedMessage,
  loadTablePage,
  PER_PAGE,
  readableFields,
  rememberedPickerView,
  rememberedView,
  rememberPickerView,
  seedLabels,
  sortableFields,
  type TableRecord,
} from './collection-table-data.ts';
import { admitsRow, pageUUIDs } from './collection-table-selection.ts';
import {
  healView,
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

css`
  .o-data-table-popup-title {
    font-weight: 500;
  }

  .o-data-table-popup .ohne-popup-content .ohne-container-content {
    height: 100%;
  }

  .o-data-table-popup-body {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .o-data-table-popup .ohne-table-select-all {
    display: none;
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
 * A view part the query endpoint refuses is dropped with a toast, as on the collection page.
 * Single mode picks on double-click or the row's Select action and closes.
 * Multiple mode selects with checkboxes and shift ranges across pages, and applies explicitly.
 * A row's actions also open the record in a new tab, as edit or view by the row's update verdict.
 * Cmd/Ctrl+S applies or closes, Cmd/Ctrl+A toggles the page's selection, and arrow keys page.
 * Create it inside a reactive region; dispose the region after `onClose`'s close resolves.
 */
export function dataTablePopup(options: DataTablePopupOptions): Popup {
  const t = useT();
  const collection = options.collection;
  const segment = collection.segment;
  const multiple = options.multiple ?? false;

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
    rememberPickerView(segment, cloneState(state));
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

  const data = ref<TableRecord[] | undefined>(undefined);
  const updatable = ref<ReadonlySet<string>>(new Set());
  const paginated = ref({ currentPage: state.page, lastPage: 1, perPage: PER_PAGE, total: 0 });
  const filterOpen = ref(false);
  const columnsOpen = ref(false);
  const sortingOpen = ref(false);
  let generation = 0;

  const queryBody = (locale: string | undefined): Record<string, unknown> => {
    const body: Record<string, unknown> = {
      // The explicit `UUID` keeps the row identity when it is not a visible column.
      select: uniqueArray(['UUID', ...specs().map((spec) => spec.name)]),
      page: state.page,
      perPage: PER_PAGE,
      order: state.order,
    };
    if (!isUndefined(state.where)) body.where = state.where;
    if (!isUndefined(locale)) body.locale = locale;
    return body;
  };

  effect(() => {
    void revision.value;
    const mine = (generation += 1);
    // Read inside the load effect, so a content-language switch reloads the page at that locale.
    const locale = collection.translatable ? activeContentLocale() : undefined;
    void loadTablePage(segment, queryBody(locale)).then(async (loaded) => {
      if (generation !== mine) return;
      if (isUndefined(loaded) || 'refused' in loaded) {
        const patch = isUndefined(loaded)
          ? undefined
          : healView(state, loaded.refused, DEFAULT_ORDER);
        if (!isUndefined(patch)) {
          toast(t(droppedMessage(patch)), { type: 'warning' });
          push(patch);
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
        updatable.value = answered.update;
        seedLabels(collection, loaded.records, locale);
        if (loaded.page > loaded.lastPage) push({ page: loaded.lastPage || 1 });
      }
      if (scrollTop) {
        scrollTop = false;
        body.querySelector('.ohne-table-scroller')?.scrollTo({ top: 0, behavior: 'instant' });
      }
    });
  });

  const sort: Ref<TableSort | null> = {
    get value() {
      void revision.value;
      return sortFromOrder(state.order);
    },
    set value(next) {
      if (isNull(next)) return;
      push({ page: 1, order: [next.direction === 'desc' ? `-${next.column}` : next.column] });
    },
  };

  const selected = ref<ReadonlySet<number | string>>(new Set(options.values));
  const selectedCount = computed(() => selected.value.size);
  const selectionChanged = computed(
    () => !deepEqual([...selected.value].map(String).sort(), [...options.values].sort()),
  );

  const select = (uuid: string): void => {
    selected.value = new Set(selected.value).add(uuid);
  };

  const deselect = (uuid: string): void => {
    const next = new Set(selected.value);
    next.delete(uuid);
    selected.value = next;
  };

  const togglePage = (): void => {
    const uuids = pageUUIDs(data.value ?? []);
    const all = uuids.every((uuid) => selected.value.has(uuid));
    const next = new Set(selected.value);
    for (const uuid of uuids) {
      if (all) next.delete(uuid);
      else next.add(uuid);
    }
    selected.value = next;
  };

  const pick = (uuid: string): void => {
    options.onApply([uuid]);
    options.onClose(handle.close);
  };

  const applySelection = (): void => {
    options.onApply([...selected.value].filter(isString));
    options.onClose(handle.close);
  };

  const rowActions = (row: TableRecord): MenuItem[] => {
    const uuid = String(row.UUID);
    const canUpdate = admitsRow(updatable.value, row.UUID);
    return [
      multiple && selected.value.has(uuid)
        ? { label: 'dashboard.deselect', icon: 'square-off', onSelect: () => deselect(uuid) }
        : {
            label: 'dashboard.select',
            icon: 'checkbox',
            onSelect: () => (multiple ? select(uuid) : pick(uuid)),
          },
      '---',
      {
        label: canUpdate ? 'dashboard.edit' : 'dashboard.view',
        icon: canUpdate ? 'pencil' : 'list-search',
        href: recordHref(collection, uuid),
        target: '_blank',
      },
    ];
  };

  const buildGrid = (): HTMLElement => {
    const columns: Record<string, TableColumn<TableRecord>> = {};
    for (const spec of specs()) {
      const field = collection.fields.find((entry) => entry.name === spec.name);
      columns[spec.name] = {
        label: () => translateMessage(spec.label),
        sortable: spec.sortable,
        width: spec.width,
        minWidth: spec.minWidth,
        render: (row) =>
          isUndefined(field)
            ? null
            : h('div', { class: 'o-data-table-popup-cell' }, displayFor(field, row)),
      };
    }
    return table(() => data.value, {
      key: (row, index) => (isString(row.UUID) ? row.UUID : index),
      columns,
      sort,
      serverSort: true,
      fixed: true,
      selection: { selected, checkboxes: () => multiple },
      onOpen: (row) => (multiple ? select(String(row.UUID)) : pick(String(row.UUID))),
      actions: rowActions,
    });
  };

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

  const viewButton = (
    glyph: IconName,
    dirty: () => boolean,
    tooltip: () => string,
    onClick: () => void,
  ): HTMLElement => {
    const el = button(tooltip, {
      icon: glyph,
      iconOnly: true,
      variant: 'outline',
      bubble: () => (dirty() ? bubble() : null),
      onClick,
    });
    effect(() => {
      const changed = dirty();
      el.classList.toggle('ohne-button-accent', changed);
      el.classList.toggle('ohne-button-outline', !changed);
    });
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

  const closeButton = button(() => t('dashboard.close'), {
    icon: 'x',
    iconOnly: true,
    size: -2,
    variant: 'ghost',
    class: 'ohne-ml-auto',
    onClick: () => options.onClose(handle.close),
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
    { class: 'o-data-table-popup-body' },
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
  const remembered = rememberedPickerView(collection.segment);
  if (!isUndefined(remembered)) return cloneState(remembered);
  const state = parseTableState(rememberedView(collection), DEFAULT_ORDER);
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
    title: () => translateMessage(request.field.label),
    values: request.values,
    multiple: request.multiple,
    onApply: request.onApply,
    onClose: (close) => void close().then(request.onClose),
  });
});

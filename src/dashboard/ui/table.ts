import type { Ref } from '../../utils/reactive/ref.ts';
import type { Child } from '../render/insert.ts';
import type { MenuItem } from './menu.ts';
import type { TableColumn, TableSelection, TableSort } from './table-model.ts';

import { isNull } from '../../utils/is/is-null.ts';
import { isNullish } from '../../utils/is/is-nullish.ts';
import { isNumber } from '../../utils/is/is-number.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { batchedEffect } from '../../utils/reactive/batched-effect.ts';
import { computed } from '../../utils/reactive/computed.ts';
import { onCleanup } from '../../utils/reactive/effect-scope.ts';
import { effect } from '../../utils/reactive/effect.ts';
import { ref } from '../../utils/reactive/ref.ts';
import { untracked } from '../../utils/reactive/untracked.ts';
import { css } from '../render/css.ts';
import { each } from '../render/each.ts';
import { h } from '../render/h.ts';
import { keyed } from '../render/keyed.ts';
import { when } from '../render/when.ts';
import { navigate } from '../router/router.ts';
import { formatNumber } from '../runtime/number.ts';
import { isResource, resourceState } from '../runtime/resource.ts';
import { defaultText, resolveText, type Text } from '../runtime/text.ts';
import { helpIcon } from './_help-icon.ts';
import { button } from './button.ts';
import { checkbox } from './checkbox.ts';
import { icon } from './icon.ts';
import { menu } from './menu.ts';
import { pagination } from './pagination.ts';
import { emptyState, errorState, skeleton } from './states.ts';
import { rangeSelect, sortRows, toggleSort } from './table-model.ts';
import { attachTooltip } from './tooltip.ts';
import './tokens.ts';

/**
 * Options for `table`.
 */
export interface TableOptions<T, K extends string | number, C extends string> {
  /**
   * A stable, unique key per row, as `each` takes it.
   * It keeps a row's DOM across sorts and refreshes, and it is what `selection` holds.
   */
  key: (row: T, index: number) => K;

  /**
   * The columns by name, in display order.
   * The name is what `sort` refers to.
   * Integer-like names reorder to the front, as JavaScript orders such keys.
   */
  columns: Record<C, TableColumn<T>>;

  /**
   * The sort, two-way: a header click writes the next one.
   * A ref typed with column names, like `TableSort<'name' | 'level'>`, must name columns that exist.
   * Omitted, the table keeps its own and starts unsorted.
   */
  sort?: Ref<TableSort<C> | null>;

  /**
   * Whether the rows arrive sorted from the server.
   * The table then only writes `sort`, and shows the rows in the order they come.
   *
   * @default
   * false
   */
  serverSort?: boolean;

  /**
   * Splits the rows into pages of this many, with page buttons under the table.
   * Omitted shows every row.
   */
  pageSize?: number;

  /**
   * What the table says when there are no rows; a `Node` renders as given.
   *
   * @default
   * 'dashboard.table.noData'
   */
  empty?: Text | Node;

  /**
   * Turns on row checkboxes, shift ranges, and the select-all box.
   */
  selection?: TableSelection<T, K>;

  /**
   * The rows of a row's actions menu, behind a trailing button.
   * Called each time the menu opens.
   */
  actions?: (row: T) => readonly MenuItem[];

  /**
   * Where a row leads when the reader opens it.
   * A modifier click or a middle click opens it in a new tab.
   */
  href?: (row: T) => string;

  /**
   * Called when the reader opens a row.
   * A click opens it, or a double-click on a table with `selection`; Enter opens a focused row.
   */
  onOpen?: (row: T) => void;

  /**
   * Lays the columns out at their set widths, so long cell text truncates.
   * Without it the columns size to their content.
   *
   * @default
   * false
   */
  fixed?: boolean;

  /**
   * The tallest the table gets, as a CSS length; the rows scroll under a sticky header past it.
   */
  maxHeight?: string;

  /**
   * Size step of the component: -2 very small, -1 small, 0 default, 1 large, 2 very large.
   * Omitted inherits `--ohne-size` from the nearest ancestor.
   */
  size?: number;
}

/**
 * Where the table body stands: the first that applies wins.
 */
type Phase = 'forbidden' | 'error' | 'loading' | 'empty' | 'rows';

const IGNORED = 'a, button, input, textarea, select, label, [contenteditable]';
const SKELETON_ROWS = 5;
const NO_KEYS: ReadonlySet<never> = new Set();

const shiftHeld = ref(false);
let shiftTracked = false;

css`
  .ohne-table {
    --ohne-table-check: calc(1rem + var(--ohne-table-button) * 0.125rem + 1.125rem);
    --ohne-table-kebab: calc(2 * (1rem + var(--ohne-table-button) * 0.125rem) + 1.75rem);
    --ohne-table-bg: hsl(var(--ohne-table-surface, var(--ohne-background)));
    --ohne-table-shadow: hsl(var(--ohne-foreground) / 0.14);
    container-type: inline-size;
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
  }

  .ohne-table-scroller {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    outline: none;
    background:
      linear-gradient(to right, var(--ohne-table-bg) 30%, transparent) left / 2.5rem 100% local,
      linear-gradient(to left, var(--ohne-table-bg) 30%, transparent) right / 2.5rem 100% local,
      linear-gradient(to right, var(--ohne-table-shadow), transparent) left / 1rem 100% scroll,
      linear-gradient(to left, var(--ohne-table-shadow), transparent) right / 1rem 100% scroll;
    background-repeat: no-repeat;
  }

  .ohne-table-grid {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    text-indent: 0;
    vertical-align: middle;
    font-size: calc(1rem + var(--ohne-size) * 0.125rem);
  }

  .ohne-table-fixed {
    table-layout: fixed;
  }

  .ohne-table-filled {
    height: 100%;
  }

  .ohne-table-grid :where(th, td) {
    border-bottom-width: 1px;
    text-align: start;
  }

  .ohne-table-grid :where(th) {
    position: sticky;
    z-index: 11;
    top: 0;
    padding: 0.6875rem 0 0.6875rem 0.75rem;
    background-color: var(--ohne-table-bg);
    font-weight: 500;
  }

  .ohne-table-grid :where(td) {
    padding: 0.5rem 0 0.5rem 0.75rem;
    color: hsl(var(--ohne-muted-foreground));
  }

  .ohne-table-grid :where(th, td):last-child {
    padding-right: 0.75rem;
  }

  .ohne-table-grid:not(.ohne-table-fixed) :where(th, td) {
    white-space: nowrap;
  }

  .ohne-table-grid :where(th, td).ohne-table-wrap {
    white-space: normal;
  }

  .ohne-table-grid :where(th, td).ohne-table-end {
    text-align: end;
  }

  .ohne-table-grid :where(th, td):is(.ohne-table-check, .ohne-table-first) {
    position: sticky;
    z-index: 12;
    left: 0;
    background-color: var(--ohne-table-bg);
  }

  .ohne-table-grid :where(th):is(.ohne-table-check, .ohne-table-first, .ohne-table-actions) {
    z-index: 13;
  }

  .ohne-table-checks :where(th, td).ohne-table-first {
    left: var(--ohne-table-check);
  }

  .ohne-table-grid :where(th, td).ohne-table-check {
    width: var(--ohne-table-check);
    min-width: var(--ohne-table-check);
  }

  .ohne-table-grid :where(th, td).ohne-table-actions {
    position: sticky;
    z-index: 12;
    right: 0;
    width: var(--ohne-table-kebab);
    min-width: var(--ohne-table-kebab);
  }

  .ohne-table-grid :where(th).ohne-table-actions {
    pointer-events: none;
  }

  .ohne-table-grid :where(td).ohne-table-actions > * {
    display: flex;
    justify-content: flex-end;
  }

  .ohne-table-check-col {
    width: var(--ohne-table-check);
  }

  .ohne-table-actions-col {
    width: var(--ohne-table-kebab);
  }

  .ohne-table-head {
    display: flex;
    gap: 0.375rem;
    align-items: center;
    min-height: 1.5em;
  }

  .ohne-table-end .ohne-table-head {
    justify-content: flex-end;
  }

  .ohne-table-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .ohne-table-sort {
    display: inline-flex;
    gap: 0.375rem;
    align-items: center;
    max-width: 100%;
    padding: 0;
    background: none;
    border: 0;
    border-radius: calc(var(--ohne-radius) - 0.125rem);
    outline: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
    transition: var(--ohne-transition);
    transition-property: box-shadow;
  }

  .ohne-table-end .ohne-table-sort {
    flex-direction: row-reverse;
  }

  .ohne-table-sort:focus-visible {
    box-shadow: 0 0 0 0.125rem hsl(var(--ohne-ring));
  }

  .ohne-table-sort > svg {
    flex-shrink: 0;
    color: hsl(var(--ohne-muted-foreground));
  }

  /* Opacity, not display, so a focused header still shows where its icon sits. */
  @media (hover: hover) {
    .ohne-table-grid
      :where(th)[aria-sort='none']:not(:hover)
      .ohne-table-sort:not(:focus-visible)
      > svg,
    .ohne-table-grid
      :where(tr):not(:hover)
      .ohne-table-kebab:not(:focus-visible, [aria-expanded='true']) {
      opacity: 0;
    }
  }

  .ohne-table-text {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .ohne-table-number {
    font-variant-numeric: tabular-nums;
  }

  .ohne-table-openable:focus-visible {
    outline: 0.125rem solid hsl(var(--ohne-ring));
    outline-offset: -0.125rem;
  }

  .ohne-table-clickable {
    cursor: pointer;
  }

  .ohne-table-clickable:hover > td {
    background-image: linear-gradient(hsl(var(--ohne-muted) / 0.5), hsl(var(--ohne-muted) / 0.5));
  }

  .ohne-table-state > td {
    white-space: normal;
  }

  .ohne-table > .ohne-pagination {
    padding-top: 0.75rem;
  }

  @container (max-width: 30rem) {
    .ohne-table-grid:not(.ohne-table-fixed) :where(th, td).ohne-table-first {
      max-width: 10rem;
      white-space: normal;
    }
  }
`;

/**
 * Installs the Shift listeners once, however many tables mount.
 * Shift is tracked on the window, so the flag can stick when focus leaves mid-hold.
 */
function trackShift(): void {
  if (shiftTracked) return;
  shiftTracked = true;
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Shift') shiftHeld.value = true;
  });
  window.addEventListener('keyup', (event) => {
    if (event.key === 'Shift') shiftHeld.value = false;
  });
}

/**
 * A data table typed by its rows, its features switched on by the options you pass.
 * `rows` answering `undefined` shows skeleton rows and `[]` the empty state; a `Resource` adds its errors.
 * Sortable headers sort on the client, or only write `sort` with `serverSort`.
 * The header sticks while the table has a bounded height.
 * The checkbox and first columns stick to the start, the actions column to the end.
 * Rows open by `href` or `onOpen`, select with checkboxes and shift ranges, and carry an actions menu.
 *
 * @example
 * ```ts
 * table(() => raiders.value, {
 *   key: (raider) => raider.name,
 *   columns: {
 *     name: { label: 'Name', value: (raider) => raider.name, sortable: 'text' },
 *     level: { label: 'Level', value: (raider) => raider.level, sortable: 'numeric', align: 'end' },
 *   },
 *   sort: ref({ column: 'level', direction: 'desc' }),
 *   href: (raider) => `/raiders/${raider.name}`,
 * })
 * ```
 */
export function table<T, K extends string | number, C extends string = string>(
  rows: () => readonly T[] | undefined,
  options: TableOptions<T, K, C>,
): HTMLElement {
  trackShift();
  const { actions, columns, key, pageSize, selection } = options;
  const entries = Object.entries(columns) as [C, TableColumn<T>][];
  const sort = options.sort ?? ref<TableSort<C> | null>(null);
  const page = ref(1);
  const anchor = ref<K | null>(null);
  const buttonSize = isUndefined(options.size) ? -3 : options.size - 2;
  // Safari ignores min-width on <col>, so its cols take the minimum as the width instead.
  const isSafari =
    window.navigator.userAgent.includes('Safari') && !window.navigator.userAgent.includes('Chrome');
  const openable = !isUndefined(options.href) || !isUndefined(options.onOpen);

  const sorted = computed((): readonly T[] | undefined => {
    const list = rows();
    const order = sort.value;
    if (isUndefined(list) || isNull(order) || options.serverSort) return list;
    const value = columns[order.column]?.value;
    return isUndefined(value) ? list : sortRows(list, value, order.direction);
  });
  const lastPage = (): number =>
    isUndefined(pageSize) ? 1 : Math.max(1, Math.ceil((sorted.value?.length ?? 0) / pageSize));
  const visible = computed((): readonly T[] | undefined => {
    const list = sorted.value;
    if (isUndefined(list) || isUndefined(pageSize)) return list;
    const start = (page.value - 1) * pageSize;
    return list.slice(start, start + pageSize);
  });
  const shown = (): readonly T[] => visible.value ?? [];
  const phase = computed((): Phase => {
    const state = resourceState(rows);
    if (state === 'forbidden') return 'forbidden';
    const list = visible.value;
    if (isUndefined(list)) return state === 'error' ? 'error' : 'loading';
    return list.length === 0 ? 'empty' : 'rows';
  });

  const selected = (): ReadonlySet<K> => selection?.selected.value ?? NO_KEYS;
  const admits = (row: T): boolean => selection?.selectable?.(row) ?? true;
  const showChecks = (): boolean => !isUndefined(selection) && (selection.checkboxes?.() ?? true);
  const columnCount = (): number =>
    entries.length + (showChecks() ? 1 : 0) + (isUndefined(actions) ? 0 : 1);

  effect(() => {
    const last = lastPage();
    if (untracked(() => page.value) > last) page.value = last;
  });

  let seenSort = untracked(() => sort.value);
  effect(() => {
    const next = sort.value;
    if (next === seenSort) return;
    seenSort = next;
    page.value = 1;
  });

  let previous = untracked(selected);
  let seenRows = untracked(rows);
  if (!isUndefined(selection)) {
    // Batched, so rows streamed in after their selection land before this compares them.
    batchedEffect(() => {
      const next = selected();
      const list = rows();
      const added = list === seenRows ? [...next].filter((item) => !previous.has(item)) : [];
      const current = untracked(() => anchor.value);
      if (added.length === 1) anchor.value = added[0]!;
      else if (!isNull(current) && !next.has(current)) anchor.value = null;
      previous = next;
      seenRows = list;
    });
  }

  const write = (next: Set<K>): void => {
    // The table's own writes set the anchor themselves, so the effect never adopts one.
    previous = next;
    if (selection) selection.selected.value = next;
  };

  const pageKeys = (): K[] =>
    shown().flatMap((row, index) => (admits(row) ? [key(row, index)] : []));

  const pageState = (): boolean | 'indeterminate' => {
    const keys = pageKeys();
    const count = keys.filter((item) => selected().has(item)).length;
    return count === 0 ? false : count === keys.length ? true : 'indeterminate';
  };

  const togglePage = (): void => {
    const keys = untracked(pageKeys);
    const next = new Set(untracked(selected));
    const adding = untracked(pageState) === false;
    for (const item of keys) {
      if (adding) next.add(item);
      else next.delete(item);
    }
    write(next);
  };

  const toggleRow = (item: K, value: boolean): void => {
    const origin = untracked(() => anchor.value);
    const list = untracked(shown);
    const onScreen = list.some((row, index) => key(row, index) === origin);
    if (untracked(() => shiftHeld.value) && !isNull(origin) && origin !== item && onScreen) {
      write(rangeSelect(list, key, untracked(selected), origin, item, value, admits));
      return;
    }
    const next = new Set(untracked(selected));
    if (value) {
      next.add(item);
      anchor.value = item;
    } else next.delete(item);
    write(next);
  };

  const open = (row: T, newTab: boolean): void => {
    options.onOpen?.(row);
    const href = options.href?.(row);
    if (isUndefined(href)) return;
    if (newTab) window.open(href, '_blank');
    else void navigate(href);
  };

  const ariaSort = (name: C): 'ascending' | 'descending' | 'none' => {
    const current = sort.value;
    if (current?.column !== name) return 'none';
    return current.direction === 'asc' ? 'ascending' : 'descending';
  };

  const sortIcon = (name: C, sortable: TableColumn<T>['sortable']): SVGSVGElement => {
    const state = ariaSort(name);
    if (state === 'none') return icon('arrows-sort');
    const kind = sortable === 'numeric' ? '-numbers' : sortable === 'text' ? '-letters' : '';
    return icon(`sort-${state}${kind}`);
  };

  const headerCell = (name: C, column: TableColumn<T>, index: number): HTMLElement => {
    const { help, label } = column;
    const sortable = column.sortable && (options.serverSort || !isUndefined(column.value));
    const labelEl = h('span', { class: 'ohne-table-label' }, () =>
      isUndefined(label) ? '' : resolveText(label),
    );
    const content = sortable
      ? h(
          'button',
          {
            type: 'button',
            class: 'ohne-table-sort ohne-raw',
            title: () =>
              ariaSort(name) === 'ascending'
                ? defaultText('dashboard.sort.descending', 'Sort in descending order')
                : defaultText('dashboard.sort.ascending', 'Sort in ascending order'),
            onClick: () => {
              sort.value = toggleSort(
                untracked(() => sort.value),
                name,
              );
            },
          },
          labelEl,
          () => sortIcon(name, column.sortable),
        )
      : labelEl;
    return h(
      'th',
      {
        scope: 'col',
        class: cellClass(column, index),
        style: options.fixed
          ? undefined
          : sizeStyle(column.width, column.minWidth ?? (column.wrap ? '16rem' : undefined)),
        'aria-sort': sortable ? () => ariaSort(name) : undefined,
      },
      h('div', { class: 'ohne-table-head' }, content, isUndefined(help) ? null : helpIcon(help)),
    );
  };

  const selectAllCell = (): HTMLElement => {
    const all = selection?.all;
    const state = all ? all.state : pageState;
    const model: Ref<boolean> = {
      get value() {
        return Boolean(state());
      },
      set value(next) {
        if (all) void all.toggle(next);
        else togglePage();
      },
    };
    const box = checkbox(model, undefined, {
      variant: 'accent',
      indeterminate: () => state() === 'indeterminate',
      ariaLabel: () =>
        isUndefined(all?.label)
          ? defaultText('dashboard.selectAll', 'Select all')
          : resolveText(all.label),
    });
    box.classList.add('ohne-table-select-all');
    const label = all?.label;
    if (!isUndefined(label)) onCleanup(attachTooltip(box, () => resolveText(label)));
    return h('th', { class: 'ohne-table-check' }, box);
  };

  const checkCell = (row: () => T, index: () => number): HTMLElement => {
    const item = (): K => key(row(), index());
    const model: Ref<boolean> = {
      get value() {
        return selected().has(item());
      },
      set value(next) {
        toggleRow(untracked(item), next);
      },
    };
    return h(
      'td',
      { class: 'ohne-table-check' },
      checkbox(model, undefined, {
        variant: 'accent',
        disabled: () => !admits(row()) || (shiftHeld.value && anchor.value === item()),
        ariaLabel: () => defaultText('dashboard.selectRow', 'Select row'),
      }),
    );
  };

  const kebabCell = (items: (row: T) => readonly MenuItem[], row: () => T): HTMLElement =>
    h('td', { class: 'ohne-table-actions' }, () => {
      // Read, so a change of rows rebuilds the button and closes its open menu.
      void visible.value;
      const trigger = button(() => defaultText('dashboard.actions', 'Actions'), {
        icon: 'dots',
        iconOnly: true,
        size: buttonSize,
        class: 'ohne-table-kebab',
      });
      return h(
        'div',
        null,
        menu(trigger, () => items(row())),
      );
    });

  const bodyCell = (column: TableColumn<T>, row: T): Child => {
    if (column.render) return column.render(row);
    const value = column.value?.(row);
    if (isNullish(value) || Number.isNaN(value)) return '';
    return isNumber(value)
      ? h('span', { class: 'ohne-table-text ohne-table-number' }, formatNumber(value))
      : h('span', { class: 'ohne-table-text' }, value);
  };

  const dataRow = (row: () => T, index: () => number): HTMLElement => {
    const fromInside = (event: Event): boolean =>
      event.target instanceof Element && !isNull(event.target.closest(IGNORED));
    const newTab = (event: MouseEvent | KeyboardEvent): boolean =>
      event.ctrlKey || event.metaKey || event.shiftKey;
    const pointer = (event: MouseEvent): void => {
      if (!fromInside(event)) open(untracked(row), newTab(event));
    };
    return h(
      'tr',
      openable
        ? {
            tabindex: 0,
            class: selection ? 'ohne-table-openable' : 'ohne-table-openable ohne-table-clickable',
            onClick: selection ? undefined : pointer,
            onDblclick: selection
              ? (event: MouseEvent) => {
                  window.getSelection()?.removeAllRanges();
                  pointer(event);
                }
              : undefined,
            onAuxclick: (event: MouseEvent) => {
              if (event.button !== 1 || isUndefined(options.href) || fromInside(event)) return;
              event.preventDefault();
              open(untracked(row), true);
            },
            onKeydown: (event: KeyboardEvent) => {
              if (event.key !== 'Enter' || event.target !== event.currentTarget) return;
              event.preventDefault();
              open(untracked(row), newTab(event));
            },
          }
        : null,
      when(showChecks, () => checkCell(row, index)),
      entries.map(([, column], position) =>
        h('td', { class: cellClass(column, position) }, () => bodyCell(column, row())),
      ),
      isUndefined(actions) ? null : kebabCell(actions, row),
    );
  };

  const stateBody = (content: Child): HTMLElement =>
    h(
      'tbody',
      null,
      h('tr', { class: 'ohne-table-state' }, h('td', { colspan: columnCount }, content)),
    );

  const skeletonBody = (): HTMLElement =>
    h(
      'tbody',
      null,
      Array.from({ length: pageSize ?? SKELETON_ROWS }, () =>
        h(
          'tr',
          null,
          when(showChecks, () => h('td', { class: 'ohne-table-check' })),
          entries.map(([, column], position) =>
            h('td', { class: cellClass(column, position) }, skeleton()),
          ),
          isUndefined(actions) ? null : h('td', { class: 'ohne-table-actions' }),
        ),
      ),
    );

  const body = (): Child => {
    const current = phase.value;
    if (current === 'forbidden') {
      return stateBody(
        emptyState(() => defaultText('dashboard.forbidden', 'You do not have access to this'), {
          icon: 'lock',
        }),
      );
    }
    if (current === 'error' && isResource(rows)) {
      return stateBody(
        errorState(
          () => rows.error()?.message ?? defaultText('dashboard.loadFailed', 'Failed to load'),
          {
            retry: () => void rows.reload(),
          },
        ),
      );
    }
    if (current === 'loading') return skeletonBody();
    if (current === 'empty') {
      const { empty } = options;
      return stateBody(
        empty instanceof Node
          ? empty
          : emptyState(() =>
              isUndefined(empty)
                ? defaultText('dashboard.table.noData', 'No data available')
                : resolveText(empty),
            ),
      );
    }
    return h('tbody', null, each(shown, key, dataRow));
  };

  const grid = h(
    'table',
    {
      class: () =>
        'ohne-table-grid' +
        (options.fixed ? ' ohne-table-fixed' : '') +
        (showChecks() ? ' ohne-table-checks' : '') +
        (phase.value === 'rows' || phase.value === 'loading' ? '' : ' ohne-table-filled'),
      'aria-busy': () => (phase.value === 'loading' ? 'true' : null),
    },
    options.fixed
      ? h(
          'colgroup',
          null,
          when(showChecks, () => h('col', { class: 'ohne-table-check-col' })),
          entries.map(([, column]) =>
            h('col', {
              style: sizeStyle(
                column.width ?? (isSafari ? column.minWidth : undefined),
                column.minWidth,
              ),
            }),
          ),
          isUndefined(actions) ? null : h('col', { class: 'ohne-table-actions-col' }),
        )
      : null,
    h(
      'thead',
      null,
      h(
        'tr',
        null,
        when(showChecks, selectAllCell),
        entries.map(([name, column], index) => headerCell(name, column, index)),
        isUndefined(actions) ? null : h('th', { class: 'ohne-table-actions' }),
      ),
    ),
    keyed(() => phase.value, body),
  );

  return h(
    'div',
    {
      class: 'ohne-table',
      style:
        `--ohne-table-button: ${buttonSize}` +
        (isUndefined(options.size) ? '' : `; --ohne-size: ${options.size}`),
    },
    h(
      'div',
      {
        tabindex: -1,
        class: 'ohne-table-scroller o-scrollbar',
        style: isUndefined(options.maxHeight) ? undefined : `max-height: ${options.maxHeight}`,
      },
      grid,
    ),
    isUndefined(pageSize)
      ? null
      : pagination({
          currentPage: () => page.value,
          lastPage,
          goToPageTitle: () => defaultText('dashboard.pagination.goToPage', 'Go to page'),
          nextPageTitle: () => defaultText('dashboard.pagination.next', 'Next page'),
          previousPageTitle: () => defaultText('dashboard.pagination.previous', 'Previous page'),
          onChange: (next) => {
            page.value = next;
          },
        }),
  );
}

/**
 * The classes a column's header and body cells share.
 */
function cellClass<T>(column: TableColumn<T>, index: number): string | undefined {
  const classes = [
    index === 0 ? 'ohne-table-first' : '',
    column.align === 'end' ? 'ohne-table-end' : '',
    column.wrap ? 'ohne-table-wrap' : '',
  ].filter((name) => name !== '');
  return classes.length === 0 ? undefined : classes.join(' ');
}

/**
 * An inline `width` and `min-width` style, or `undefined` when neither is set.
 */
function sizeStyle(width: string | undefined, minWidth: string | undefined): string | undefined {
  const rules = [
    isUndefined(width) ? '' : `width: ${width}`,
    isUndefined(minWidth) ? '' : `min-width: ${minWidth}`,
  ].filter((rule) => rule !== '');
  return rules.length === 0 ? undefined : rules.join('; ');
}

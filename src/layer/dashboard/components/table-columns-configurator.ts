import {
  button,
  type Child,
  css,
  type DashboardField,
  h,
  icon,
  iconGroup,
  numberInput,
  type Primitive,
  select,
  type SelectChoice,
  structure,
  useT,
  when,
} from 'ohne/dashboard';
import { effect, first, isNull, isNumber, isUndefined, type Ref, ref, untracked } from 'ohne/utils';

import {
  editableTableColumns,
  serializeTableColumnEdits,
  type TableColumnEdit,
} from './collection-table-state.ts';
import { actionButton } from './item-actions.ts';

/**
 * Options for `tableColumnsConfigurator`.
 */
export interface TableColumnsConfiguratorOptions {
  /**
   * The current column entries, read reactively: one `name|width|minWidth` string per column.
   */
  model: () => readonly string[];

  /**
   * The fields the editor offers as columns, read reactively.
   */
  fields: () => DashboardField[];

  /**
   * Called with the rebuilt entries after every change.
   */
  onCommit: (columns: string[]) => void;
}

const FIXED_WIDTH = 256;

let sequence = 0;

css`
  .ohne-structure:not(.ohne-structure-empty) + .o-table-columns-add {
    margin-top: 0.75rem;
  }
`;

/**
 * The table columns editor.
 *
 * Each column is a card: a field select beside the width controls.
 * A width is either a pixel count or automatic; another CSS width is preserved but not edited.
 * Rows reorder by drag and by the move actions, which reveal on hover or focus.
 * A field appears in one column at most; taken fields render disabled in the other selects.
 * It emits `name|width|minWidth` entries, the form the `columns` URL param carries.
 */
export function tableColumnsConfigurator(options: TableColumnsConfiguratorOptions): HTMLElement {
  const t = useT();
  const id = `o-table-columns-${++sequence}`;
  const items = ref<TableColumnEdit[]>([]);

  effect(() => {
    items.value = editableTableColumns(options.model(), options.fields());
  });

  const commit = (next: TableColumnEdit[]): void => {
    items.value = next;
    options.onCommit(serializeTableColumnEdits(next));
  };

  // The excluded pair stays selectable, but a new column prefers the fields the default set draws from.
  const freeField = (): DashboardField | undefined => {
    const free = options
      .fields()
      .filter((field) => items.value.every((item) => item.name !== field.name));
    return (
      free.find((field) => field.name !== 'UUID' && field.name !== '_updatedAt') ?? first(free)
    );
  };

  const addColumn = (index?: number): void => {
    const field = freeField();
    if (isUndefined(field)) return;
    const next = [...items.value];
    next.splice(index ?? next.length, 0, { $key: field.name, name: field.name, width: null });
    commit(next);
  };

  const swap = (index: number, offset: number): void => {
    const next = [...items.value];
    const other = next[index + offset];
    const current = next[index];
    if (isUndefined(other) || isUndefined(current)) return;
    next[index + offset] = current;
    next[index] = other;
    commit(next);
  };

  const header = (item: () => TableColumnEdit, index: () => number): Child => [
    h(
      'span',
      { class: 'ohne-muted ohne-truncate' },
      () => `${index() + 1}. ${t('dashboard.columns.column')}`,
    ),
    h(
      'div',
      { class: 'o-item-actions' },
      when(
        () => items.value.length > 1,
        () => [
          actionButton(
            'chevron-up',
            () => t('dashboard.sort.moveUp'),
            () => swap(index(), -1),
            { disabled: () => index() === 0 },
          ),
          actionButton(
            'chevron-down',
            () => t('dashboard.sort.moveDown'),
            () => swap(index(), 1),
            { disabled: () => index() === items.value.length - 1 },
          ),
        ],
      ),
      actionButton(
        'arrow-bar-to-up',
        () => t('dashboard.sort.addBefore'),
        () => addColumn(index()),
        { disabled: () => items.value.length >= options.fields().length },
      ),
      actionButton(
        'trash',
        () => t('dashboard.delete'),
        () => {
          const next = [...items.value];
          next.splice(index(), 1);
          commit(next);
        },
        { destructiveHover: true, disabled: () => items.value.length < 2 },
      ),
    ),
  ];

  const fieldSelect = (item: () => TableColumnEdit): HTMLElement => {
    const model: Ref<Primitive> = {
      get value() {
        return item().name;
      },
      set value(next) {
        const field = options.fields().find((candidate) => candidate.name === String(next));
        if (isUndefined(field)) return;
        const previous = item().name;
        commit(
          items.value.map((candidate) =>
            candidate.name === previous
              ? { ...candidate, $key: field.name, name: field.name }
              : candidate,
          ),
        );
      },
    };
    return select(
      model,
      (): SelectChoice[] =>
        options
          .fields()
          .map((field) =>
            field.name === item().name ||
            items.value.every((candidate) => candidate.name !== field.name)
              ? { label: field.label, value: field.name }
              : { label: field.label, value: field.name, disabled: true },
          ),
      // Untracked: the id is static, and a tracked read would rebuild the row on every width toggle.
      { id: `${id}-${untracked(() => item().name)}-field`, name: id },
    );
  };

  const widthInput = (item: () => TableColumnEdit): HTMLElement => {
    const width: Ref<number> = {
      get value() {
        const current = item().width;
        return isNumber(current) ? current : FIXED_WIDTH;
      },
      set value(next) {
        item().width = next;
      },
    };
    return h(
      'div',
      { class: 'ohne-shrink-0' },
      numberInput(width, {
        min: 64,
        suffix: 'px',
        autoWidth: true,
        showDragButton: true,
        onCommit: () => commit([...items.value]),
      }),
    );
  };

  const widthToggle = (item: () => TableColumnEdit): HTMLElement => {
    const model: Ref<Primitive> = {
      get value() {
        const current = item().width;
        return isNull(current) ? null : current !== false;
      },
      set value(next) {
        item().width = next === true ? FIXED_WIDTH : null;
        commit([...items.value]);
      },
    };
    return iconGroup(model, {
      choices: () => [
        { value: true, icon: 'forms', title: t('dashboard.columns.fixedWidth') },
        { value: null, icon: 'arrow-autofit-width', title: t('dashboard.columns.autoWidth') },
      ],
      variant: 'accent',
      showTooltips: true,
      id: `${id}-width`,
      name: `${id}-width`,
    });
  };

  const row = (item: () => TableColumnEdit): Child =>
    h(
      'div',
      { class: 'ohne-row' },
      fieldSelect(item),
      when(
        () => isNumber(item().width),
        () => widthInput(item),
      ),
      widthToggle(item),
    );

  return h(
    'div',
    { class: 'o-table-columns' },
    structure<TableColumnEdit>(items, { header, item: row, onCommit: commit }),
    button([icon('plus'), h('span', null, () => t('dashboard.columns.column'))], {
      variant: 'outline',
      class: 'o-table-columns-add',
      disabled: () => options.fields().length === items.value.length,
      onClick: () => addColumn(),
    }),
  );
}

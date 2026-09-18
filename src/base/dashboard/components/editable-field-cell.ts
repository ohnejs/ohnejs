import {
  attachTooltip,
  button,
  type Child,
  css,
  type DashboardCollection,
  type DashboardField,
  h,
  icon,
  type IconName,
  type TableCell,
  type TableColumns,
  useT,
  when,
} from 'ohnejs/dashboard';
import { effect, isNull, isUndefined, onCleanup, ref } from 'ohnejs/utils';

import {
  editQueryParam,
  editTableFieldPopup,
  setEditQueryParam,
} from './edit-table-field-popup.ts';

/**
 * Options for `editableFieldCell`.
 */
export interface EditableFieldCellOptions {
  /**
   * The table cell payload carrying the row and column the cell renders.
   */
  cell: TableCell<TableColumns>;

  /**
   * The collection the row belongs to; the edit popup writes through it.
   */
  collection: DashboardCollection;

  /**
   * The field the cell shows and the popup edits.
   */
  field: DashboardField;

  /**
   * Whether the field is editable; a read-only field opens the popup in view mode.
   */
  editable: boolean;

  /**
   * Controls how the edit button is positioned within its container.
   *
   * - `'relative'` - in the row flow, after the content.
   * - `'absolute'` - pinned to the cell's bottom right corner.
   * - `'auto'` - `'absolute'` when the last `.o-item` leaves under `32px` of room, else `'relative'`.
   *
   * @default
   * 'relative'
   */
  editButtonPosition?: 'auto' | 'absolute' | 'relative';

  /**
   * Whether the content wraps to the next line when there is not enough space.
   *
   * @default
   * false
   */
  wrap?: boolean;

  /**
   * Forces the edit button even when `hideActions` asks to hide it.
   *
   * @default
   * false
   */
  force?: boolean;

  /**
   * Hides the edit button, for hosts that render cells outside an editable table.
   *
   * @default
   * false
   */
  hideActions?: boolean;

  /**
   * Called with the answered record after the popup saves, so the host can replace its row.
   */
  onUpdated?(record: Record<string, unknown>): void;

  /**
   * A host action in place of the field edit: the hover button's glyph, its tooltip, and the click.
   * The single-field popup never mounts, and the `edit` query parameter never opens it.
   */
  action?: { icon: IconName; tooltip: () => string; onClick(): void };
}

css`
  .o-editable-field-cell {
    position: relative;
    display: flex;
    gap: 0.5rem;
    align-items: center;
    min-height: 1.5rem;
  }

  .o-editable-field-cell-wrap {
    flex-wrap: wrap;
  }

  /* Opacity, not display, so the button stays tabbable and its own focus trips td:focus-within. */
  .o-editable-field-cell-button {
    flex-shrink: 0;
    display: inline-flex;
    opacity: 0;
  }

  :where(td):hover .o-editable-field-cell-button,
  :where(td):focus-within .o-editable-field-cell-button {
    opacity: 1;
  }

  .o-editable-field-cell-button-absolute {
    position: absolute;
    right: 0;
    bottom: 0;
    margin: -0.125rem;
    padding: 0.125rem;
    background-color: hsl(var(--ohne-background));
    border-radius: var(--ohne-radius);
  }
`;

/**
 * The editable cell wrapper.
 *
 * It renders the field's display content with a hover-revealed edit button.
 * Clicking sets the `edit=[<field>,<id>]` query parameter.
 * While the parameter names this cell, the single-field edit popup mounts.
 * A read-only field opens in view mode.
 * An `action` swaps the edit for the host's own button, and the popup never mounts.
 */
export function editableFieldCell(
  content: Child | (() => Child),
  options: EditableFieldCellOptions,
): HTMLElement {
  const t = useT();
  const { action } = options;
  const position = options.editButtonPosition ?? 'relative';
  const resolved = ref<'absolute' | 'relative'>(position === 'auto' ? 'relative' : position);
  const hidden = options.hideActions === true && options.force !== true;
  const rowID = String(options.cell.row.id);
  const open = ref(false);

  if (isUndefined(action)) {
    effect(() => {
      const [fieldName, id] = editQueryParam();
      if (fieldName === options.field.name && id === rowID) open.value = true;
    });
  }

  const editButton = button(icon(action?.icon ?? (options.editable ? 'pencil' : 'list-search')), {
    size: -3,
    variant: 'outline',
    onClick: () =>
      isUndefined(action) ? setEditQueryParam([options.field.name, rowID]) : action.onClick(),
  });
  onCleanup(
    attachTooltip(editButton, () =>
      isUndefined(action)
        ? t(options.editable ? 'dashboard.editFieldValue' : 'dashboard.viewFieldValue')
        : action.tooltip(),
    ),
  );

  const root = h(
    'div',
    {
      class: () =>
        'o-editable-field-cell' + (options.wrap === true ? ' o-editable-field-cell-wrap' : ''),
    },
    isUndefined(content) ? '-' : content,
    hidden
      ? null
      : h(
          'div',
          {
            class: () =>
              `o-editable-field-cell-button o-editable-field-cell-button-${resolved.value}`,
          },
          editButton,
        ),
    when(
      () => open.value,
      () => {
        editTableFieldPopup({
          collection: options.collection,
          field: options.field,
          uuid: rowID,
          value: (options.cell.row as Record<string, unknown>)[options.field.name],
          disabled: !options.editable,
          onClose: (close) =>
            void close().then(() => {
              open.value = false;
            }),
          onUpdated: options.onUpdated,
        });
        return null;
      },
    ),
  );

  setTimeout(() => {
    if (position !== 'auto') return;
    const cell = root.closest('td');
    const lastItem = root.querySelector('.o-item:last-of-type');
    if (isNull(cell) || isNull(lastItem)) return;
    const { right: parentRight } = cell.getBoundingClientRect();
    const { right: childRight } = lastItem.getBoundingClientRect();
    resolved.value = parentRight - childRight < 32 ? 'absolute' : 'relative';
  });

  return root;
}

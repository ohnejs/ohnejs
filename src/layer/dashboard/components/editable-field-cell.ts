import {
  button,
  type Child,
  css,
  type DashboardCollection,
  type DashboardField,
  h,
  icon,
  type TableCell,
  type TableColumns,
  useT,
  when,
} from 'ohne/dashboard';
import { effect, isNull, isString, isUndefined, ref } from 'ohne/utils';

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
   * The port of the source's `hideEditableFieldCellActions` injection.
   *
   * @default
   * false
   */
  hideActions?: boolean;

  /**
   * Called with the answered record after the popup saves, so the host can replace its row.
   */
  onUpdated?(record: Record<string, unknown>): void;
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

  .o-editable-field-cell-button {
    flex-shrink: 0;
    display: none;
  }

  :where(td):hover .o-editable-field-cell-button,
  :where(td):focus-within .o-editable-field-cell-button {
    display: inline-flex;
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
 * The editable cell wrapper, ported from Pruvious v4's `EditableFieldCell`.
 *
 * It renders the field's display content with a hover-revealed edit button; clicking sets the
 * `edit=<field>:<id>` query parameter, exactly as the source.
 * It also owns the deep link, the part every source table-field component repeated: while the
 * parameter names this cell, the single-field edit popup is mounted, in view mode for a
 * read-only field.
 */
export function editableFieldCell(
  content: Child | (() => Child),
  options: EditableFieldCellOptions,
): HTMLElement {
  const t = useT();
  const position = options.editButtonPosition ?? 'relative';
  const resolved = ref<'absolute' | 'relative'>(position === 'auto' ? 'relative' : position);
  const hidden = options.hideActions === true && options.force !== true;
  const rowID = String(options.cell.row.id);
  const open = ref(false);

  effect(() => {
    const edit = editQueryParam();
    if (isString(edit)) {
      const [fieldName, id] = edit.split(':');
      if (fieldName === options.field.name && id === rowID) open.value = true;
    }
  });

  const editButton = button(icon(options.editable ? 'pencil' : 'list-search'), {
    size: -3,
    variant: 'outline',
    onClick: () => setEditQueryParam(`${options.field.name}:${rowID}`),
  });
  effect(() => {
    editButton.title = t(
      options.editable ? 'dashboard.editFieldValue' : 'dashboard.viewFieldValue',
    );
  });

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

import type { Child } from '../render/insert.ts';
import type { DashboardField } from '../runtime/meta-types.ts';

import { isArray } from '../../utils/is/is-array.ts';
import { isNull } from '../../utils/is/is-null.ts';
import { isNullish } from '../../utils/is/is-nullish.ts';
import { isPlainObject } from '../../utils/is/is-plain-object.ts';
import { isString } from '../../utils/is/is-string.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';

/**
 * What a cell's display renderer receives.
 */
export interface FieldCellContext {
  /**
   * The field, as the discovery read describes it.
   */
  field: DashboardField;

  /**
   * The cell's live value; read it inside a nested function child to follow row updates.
   */
  value: () => unknown;

  /**
   * The dashboard's active language, for locale-aware formatting.
   */
  language: () => string;
}

/**
 * How a requested write ended, as the editor's `commit` resolves it.
 */
export interface CommitLanding {
  /**
   * Whether the write landed and the editor closed.
   * A vanished row also lands: the editor closes and the sheet reloads.
   */
  landed: boolean;

  /**
   * The server's per-path validation messages when the write answered `422`.
   * Paths are dot-and-bracket from the record root, like `sections[2].heading`.
   */
  errors?: Readonly<Record<string, string>>;
}

/**
 * What a cell's editor receives on top of the display context.
 */
export interface FieldEditorContext extends FieldCellContext {
  /**
   * Requests the write, resolving how it landed.
   * A rejected or failed write keeps the editor open with the cell marked.
   */
  commit(value: unknown): Promise<CommitLanding>;

  /**
   * Closes the editor without writing and clears the cell's pending error mark.
   */
  cancel(): void;
}

/**
 * One field type's sheet cell: how its values display, and how they edit inline.
 */
export interface FieldCell {
  /**
   * Renders the cell's display content.
   */
  display(context: FieldCellContext): Child;

  /**
   * Renders the cell's inline editor; a cell without one is not editable in place.
   */
  editor?(context: FieldEditorContext): Child;
}

const registry = new Map<string, FieldCell>();

css`
  .cell-dim {
    color: var(--dim);
  }

  .cell-mono {
    font-family: var(--mono);
    font-size: 12px;
  }
`;

/**
 * Registers the sheet cell for a field type, by its registered type name.
 * A name that already exists is overridden, so an app replaces a framework cell by re-registering it.
 *
 * @example
 * ```ts
 * registerFieldCell('rating', { display: ({ value }) => () => '★'.repeat(Number(value() ?? 0)) })
 * ```
 */
export function registerFieldCell(type: string, cell: FieldCell): void {
  registry.set(type, cell);
}

/**
 * Resolves the sheet cell for a field, falling back to a generic display-only cell.
 * The fallback renders primitives as text, lists as counts, and objects as a dim mark.
 */
export function fieldCellFor(field: DashboardField): FieldCell {
  const cell = isNull(field.type) ? undefined : registry.get(field.type);
  return cell ?? FALLBACK;
}

/**
 * A dim placeholder mark, shared by cells for absent and summarized values.
 */
export function dimMark(text: string): Child {
  return h('span', { class: 'cell-dim' }, text);
}

const FALLBACK: FieldCell = {
  display({ value }) {
    return () => {
      const current = value();
      if (isNullish(current)) return dimMark('·');
      if (isArray(current)) {
        return current.every(isString) ? current.join(', ') : dimMark(`[${current.length}]`);
      }
      if (isPlainObject(current)) return dimMark('{…}');
      return String(current as string | number | boolean);
    };
  },
};

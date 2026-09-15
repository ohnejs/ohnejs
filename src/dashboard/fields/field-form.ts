import type { Child } from '../render/insert.ts';
import type { DashboardField } from '../runtime/meta-types.ts';
import type { ControlReading, FieldControl } from './field-type.ts';

import { isEmpty } from '../../utils/is/is-empty.ts';
import { isString } from '../../utils/is/is-string.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { effectScope } from '../../utils/reactive/effect-scope.ts';
import { untracked } from '../../utils/reactive/untracked.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { useT } from '../runtime/use-t.ts';
import { blocksOf } from './_blocks.ts';
import { carriedField, carryValue } from './_items.ts';
import { fieldRow } from './field-row.ts';
import { fieldTypeFor, registeredFieldType } from './field-type.ts';

/**
 * Options for `createFieldForm`.
 */
export interface FieldFormOptions {
  /**
   * Create keeps immutable fields settable; edit locks them on an existing item.
   */
  mode: 'create' | 'edit';

  /**
   * The path the form's fields scope under, like `sections[2].fields`; `''` at the record root.
   */
  path: string;

  /**
   * Attaches an existing item's `UUID` to the read value, keeping its row on a list write.
   * The wire accepts item `UUID`s only inside `childMany` lists.
   *
   * @default
   * false
   */
  attachUUID?: boolean;

  /**
   * Renders the item's `UUID` as a row, for a form built over that one field.
   * It is never writable, so it shows only under `readOnlyRows` or `readOnly`.
   * Omitted, it never renders: a nested item carries its identity without showing it.
   *
   * @default
   * false
   */
  renderUUID?: boolean;

  /**
   * Renders readable fields the form cannot edit as locked rows.
   * A field with a registered control renders it disabled; one without renders display-only.
   * Omitted, such fields are carried through silently, the right shape for nested items.
   *
   * @default
   * false
   */
  readOnlyRows?: boolean;

  /**
   * Renders every readable field as a locked row, for a viewer who cannot write.
   *
   * @default
   * false
   */
  readOnly?: boolean;

  /**
   * Builds every control disabled, for a composite whose own row is locked.
   * The form renders full field layouts that only display; reads collect nothing.
   *
   * @default
   * false
   */
  disabled?: boolean;

  /**
   * The dashboard's active language, handed to every control.
   */
  language: () => string;

  /**
   * Fires on any user change in any of the form's controls.
   */
  onInput?(): void;
}

/**
 * A form over one field list: controls in, a wire-legal value out.
 *
 * Fields whose type registers a `control` render as rows.
 * Writable fields without one carry their stored value through unchanged.
 * A whole-item write therefore never blanks them.
 * The form is itself control-shaped, so composites nest it for their items.
 */
export interface FieldForm {
  /**
   * The form's rows, one per rendered field, in field order.
   */
  render(): Child;

  /**
   * Reads the whole value: every control's current value beside the carried fields.
   * Any control that fails to parse blocks the read with its messages instead.
   */
  read(): ControlReading;

  /**
   * Reads only the dirty fields, for a partial `PATCH`; carried fields never appear.
   */
  readPatch(): ControlReading;

  /**
   * Routes server messages onto the form's controls, keyed relative to the form.
   * Each call replaces the previous routing, so `{}` clears every routed message.
   * Returns the first message that matched no control, or `''` when every message placed.
   */
  setErrors(errors: Readonly<Record<string, string>>): string;

  /**
   * Whether any control currently shows a message. Reactive.
   */
  errored(): boolean;

  /**
   * Whether any control differs from its baseline. Reactive.
   */
  dirty(): boolean;

  /**
   * Focuses the form's first control, for a composite delegating its own focus.
   */
  focus(): void;

  /**
   * Focuses the first errored control, answering whether there was one.
   */
  focusError(): boolean;

  /**
   * Restores every control to its baseline, clearing dirt and messages.
   */
  revert(): void;

  /**
   * Re-baselines the whole form from a saved item, so `dirty` clears without a remount.
   */
  rebase(item: Readonly<Record<string, unknown>> | undefined): void;

  /**
   * Releases every effect the form's controls created.
   * A form built inside a live scope dies with it.
   * One built later, in an async continuation or an event handler, must be disposed by its owner.
   * Its effects would otherwise outlive the surface.
   */
  dispose(): void;
}

interface ControlRow {
  field: DashboardField;
  path: string;
  control: FieldControl;
}

css`
  .ohne-fieldrow-static {
    display: flex;
    align-items: center;
    min-height: calc(2em + 0.25rem);
    color: hsl(var(--ohne-muted-foreground));
  }
`;

/**
 * Builds a `FieldForm` over `fields`, seeded from `initial`, an existing item or `undefined`.
 * The item `UUID` renders as a row only under `renderUUID`.
 * `attachUUID` decides whether it rides the read value.
 */
export function createFieldForm(
  fields: readonly DashboardField[],
  initial: Readonly<Record<string, unknown>> | undefined,
  options: FieldFormOptions,
): FieldForm {
  let seed = initial;
  const scope = effectScope();
  const rows: ControlRow[] = [];
  const lockedRows: ControlRow[] = [];
  const carried: DashboardField[] = [];
  const statics: DashboardField[] = [];
  const editorless = new Set<DashboardField>();
  const showsLocked =
    options.readOnlyRows === true || options.readOnly === true || options.disabled === true;

  for (const field of fields) {
    if (field.name === 'UUID' && options.renderUUID !== true) continue;
    const path = options.path === '' ? field.name : `${options.path}.${field.name}`;
    // Create mode always qualifies, so an undo-restored create form does not lock the field.
    const settable =
      options.disabled !== true &&
      options.readOnly !== true &&
      field.writable &&
      (!field.immutable || options.mode === 'create' || isUndefined(initial));
    const lockable =
      !settable &&
      showsLocked &&
      field.readable &&
      !isUndefined(registeredFieldType(field)?.control);
    // Construction runs untracked: a control's own reads must not subscribe the ambient region.
    const control =
      settable || lockable
        ? scope.run(() =>
            untracked(() =>
              fieldTypeFor(field).control?.({
                field,
                initial: initial?.[field.name],
                mode: options.mode,
                path,
                disabled: !settable,
                language: options.language,
                onInput: () => options.onInput?.(),
              }),
            ),
          )
        : undefined;
    if (!isUndefined(control)) {
      (settable ? rows : lockedRows).push({ field, path, control });
      continue;
    }
    if (settable) editorless.add(field);
    if (field.writable && !field.immutable && carriedField(field)) carried.push(field);
    if (showsLocked && field.readable) statics.push(field);
  }

  const rowByName = new Map(rows.map((row) => [row.field.name, row]));
  const lockedByName = new Map(lockedRows.map((row) => [row.field.name, row]));
  const ordered = fields.filter(
    (field) => rowByName.has(field.name) || lockedByName.has(field.name) || statics.includes(field),
  );

  const collect = (selected: readonly ControlRow[], withCarry: boolean): ControlReading => {
    const item: Record<string, unknown> = {};
    const errors: Record<string, string> = blank();
    if (withCarry) {
      const blocks = blocksOf();
      for (const field of carried) {
        const value = carryValue(field, seed?.[field.name], blocks);
        if (!isUndefined(value)) item[field.name] = value;
      }
    }
    for (const row of selected) {
      const reading = row.control.read();
      if (!isUndefined(reading.errors)) {
        for (const [key, message] of Object.entries(reading.errors)) {
          errors[joinPath(row.field.name, key)] = message;
        }
      } else if (!isUndefined(reading.value)) {
        item[row.field.name] = reading.value;
      }
    }
    if (!isEmpty(errors)) return { errors };
    if (options.attachUUID === true && isString(seed?.UUID)) item.UUID = seed.UUID;
    return { value: item };
  };

  return {
    render() {
      return ordered.map((field) => {
        const lockedRow = lockedByName.get(field.name);
        if (!isUndefined(lockedRow)) {
          return fieldRow({ field, path: lockedRow.path, locked: true }, lockedRow.control.element);
        }
        const row = rowByName.get(field.name);
        if (isUndefined(row)) {
          return staticRow(field, options, () => seed?.[field.name], editorless.has(field));
        }
        const { control } = row;
        return fieldRow(
          {
            field,
            path: row.path,
            dirty: () => control.dirty(),
            // A revert is a user change: without the ping, history still guards navigation as unsaved.
            onRevert: () => {
              control.revert();
              options.onInput?.();
            },
            error: () => control.error(),
            onLabelClick: () => control.focus(),
          },
          control.element,
        );
      });
    },
    read() {
      return collect(rows, true);
    },
    readPatch() {
      return collect(
        rows.filter((row) => row.control.dirty()),
        false,
      );
    },
    setErrors(errors) {
      let unplaced = '';
      const grouped = new Map<string, Record<string, string>>();
      for (const row of rows) grouped.set(row.field.name, blank());
      for (const [key, message] of Object.entries(errors)) {
        const segment = firstSegment(key);
        const scoped = grouped.get(segment);
        if (isUndefined(scoped)) {
          if (unplaced === '') unplaced = message;
          continue;
        }
        const rest = key.slice(segment.length);
        scoped[rest.startsWith('.') ? rest.slice(1) : rest] = message;
      }
      for (const row of rows) {
        const leftover = row.control.setErrors(grouped.get(row.field.name) ?? blank());
        if (leftover !== '' && unplaced === '') unplaced = leftover;
      }
      return unplaced;
    },
    errored() {
      return rows.some((row) => rowErrored(row));
    },
    dirty() {
      return rows.some((row) => row.control.dirty());
    },
    focus() {
      rows[0]?.control.focus();
    },
    focusError() {
      const errored = rows.find((row) => rowErrored(row));
      if (isUndefined(errored)) return false;
      errored.control.focus();
      return true;
    },
    revert() {
      for (const row of rows) row.control.revert();
    },
    rebase(item) {
      seed = item;
      for (const row of rows) row.control.rebase(item?.[row.field.name]);
      for (const row of lockedRows) row.control.rebase(item?.[row.field.name]);
    },
    dispose() {
      scope.dispose();
    },
  };
}

/**
 * The messages under `prefix`, re-keyed without it, for routing a `422` into one item's form.
 */
export function scopedErrors(
  errors: Readonly<Record<string, string>>,
  prefix: string,
): Record<string, string> {
  const scoped = blank();
  for (const [key, message] of Object.entries(errors)) {
    if (key.startsWith(prefix)) scoped[key.slice(prefix.length)] = message;
  }
  return scoped;
}

/**
 * A locked display-only row for a readable field without a registered control.
 * `editorless` marks a field the form would edit but cannot; its lock explains that instead.
 */
function staticRow(
  field: DashboardField,
  options: FieldFormOptions,
  value: () => unknown,
  editorless: boolean,
): Child {
  const t = useT();
  const path = options.path === '' ? field.name : `${options.path}.${field.name}`;
  return fieldRow(
    {
      field,
      path,
      locked: true,
      lockedHint: editorless ? () => t('dashboard.field.noEditor') : undefined,
    },
    h(
      'div',
      { class: 'ohne-fieldrow-static' },
      fieldTypeFor(field).display({ field, value, language: options.language }),
    ),
  );
}

/**
 * Whether the row's control carries a message, its nested forms included.
 */
function rowErrored(row: ControlRow): boolean {
  return row.control.error() !== '' || row.control.errored?.() === true;
}

/**
 * The path's first segment: the field name before any `.` or `[`.
 */
function firstSegment(path: string): string {
  const match = /^[^.[]+/.exec(path);
  return match?.[0] ?? '';
}

/**
 * `rest` re-anchored under `name`: an index chains directly, a subfield joins with a dot.
 */
function joinPath(name: string, rest: string): string {
  if (rest === '') return name;
  return rest.startsWith('[') ? `${name}${rest}` : `${name}.${rest}`;
}

/**
 * A fresh error map with no prototype, since field paths may collide with `Object` keys.
 */
function blank(): Record<string, string> {
  return Object.create(null) as Record<string, string>;
}

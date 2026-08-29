import type { Child } from '../render/insert.ts';
import type { DashboardField } from '../runtime/meta-types.ts';

import { isArray } from '../../utils/is/is-array.ts';
import { isNull } from '../../utils/is/is-null.ts';
import { isNullish } from '../../utils/is/is-nullish.ts';
import { isPlainObject } from '../../utils/is/is-plain-object.ts';
import { isString } from '../../utils/is/is-string.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { ref } from '../../utils/reactive/ref.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { useT } from '../runtime/use-t.ts';
import { alert } from '../ui/alert.ts';
import { icon } from '../ui/icon.ts';
import { prose, renderProse } from '../ui/prose.ts';

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
 * What a field's form control receives.
 */
export interface FieldControlContext {
  /**
   * The field, as the discovery read describes it.
   */
  field: DashboardField;

  /**
   * The stored value the control edits; `undefined` in create mode.
   */
  initial: unknown;

  /**
   * Create omits pristine fields so server defaults apply; edit patches only dirty ones.
   */
  mode: 'create' | 'edit';

  /**
   * The field's dot-and-bracket path from the record root, like `sections[2].heading`.
   * Seeds element ids and scopes error routing; `''` only while a host builds nested paths.
   */
  path: string;

  /**
   * Renders the control non-interactive and dimmed, for a locked row.
   * A locked control only displays: the hosting form never reads, focuses, or error-routes it.
   *
   * @default
   * false
   */
  disabled?: boolean;

  /**
   * The dashboard's active language, for locale-aware formatting.
   */
  language: () => string;

  /**
   * Fires on any user change, so the host can clear a stale failure line.
   */
  onInput(): void;
}

/**
 * What a control's `read` yields.
 * `{}` omits the field, `{ value }` sends it, and any `errors` block the write.
 */
export interface ControlReading {
  /**
   * The wire value to send; omitted, the field is left out of the write entirely.
   */
  value?: unknown;

  /**
   * Local validation messages keyed by path relative to the field; `''` keys the control itself.
   */
  errors?: Readonly<Record<string, string>>;
}

/**
 * A live form control: state lives in the control, verdicts flow through the handle.
 * The hosting form owns the write; a control never talks to the network for its value.
 */
export interface FieldControl {
  /**
   * The rendered control.
   */
  element: Child;

  /**
   * Parses the current state into its wire value, or into the messages that block the write.
   */
  read(): ControlReading;

  /**
   * Routes server messages keyed relative to this field; `''` addresses the control itself.
   * Returns the first message that found no home, or `''` when every message placed.
   */
  setErrors(errors: Readonly<Record<string, string>>): string;

  /**
   * The control's own message, reactive; the hosting row renders it.
   */
  error(): string;

  /**
   * Whether any message sits below the control's own line, for composites holding nested forms.
   * Omitted, `error` alone decides; the hosting form reads it for the first-error jump.
   */
  errored?(): boolean;

  /**
   * Whether the parsed value differs from the baseline. Reactive.
   */
  dirty(): boolean;

  /**
   * Moves focus into the control, for the first-error jump after a failed save.
   */
  focus(): void;

  /**
   * Restores the control to its baseline, clearing `dirty` and its messages.
   */
  revert(): void;

  /**
   * Re-baselines the control after a successful save, so `dirty` clears without a remount.
   */
  rebase(value: unknown): void;
}

/**
 * One field type's dashboard behaviour: how it displays in a cell, edits in place, and edits in a form.
 */
export interface FieldType {
  /**
   * Renders the cell's display content.
   */
  display(context: FieldCellContext): Child;

  /**
   * Renders the cell's inline editor; a cell without one is not editable in place.
   */
  editor?(context: FieldEditorContext): Child;

  /**
   * Creates the field's form control; a type without one renders read-only in forms.
   * Yielding `undefined` refuses one instance, like a composite whose subfields cannot round-trip.
   * The hosting form then carries the stored value through unchanged.
   */
  control?(context: FieldControlContext): FieldControl | undefined;
}

const registry = new Map<string, FieldType>();

css`
  .cell-dim {
    color: hsl(var(--ohne-muted-foreground));
  }

  .cell-faint {
    color: hsl(var(--ohne-muted-foreground) / 0.64);
  }

  .cell-mono {
    font-family: var(--ohne-font-mono);
    font-size: 0.75rem;
  }
`;

/**
 * Registers the dashboard behaviour for a field type, by its registered type name.
 * A name that already exists is overridden, so an app replaces a builtin by re-registering it.
 * Cell and control override together: the sheet and the form never disagree about one type.
 *
 * @example
 * ```ts
 * registerFieldType('rating', { display: ({ value }) => () => '★'.repeat(Number(value() ?? 0)) })
 * ```
 */
export function registerFieldType(type: string, fieldType: FieldType): void {
  registry.set(type, fieldType);
}

/**
 * Resolves the dashboard behaviour for a field, falling back for an unregistered type name.
 * A plain column falls back to its storage primitive's registered behaviour.
 * An app-defined scalar type therefore edits as text, number, or boolean without registering anything.
 * Everything else falls back to a generic display-only type.
 * That fallback renders primitives as text, lists as counts, and objects as a dim mark.
 */
export function fieldTypeFor(field: DashboardField): FieldType {
  return registeredFieldType(field) ?? FALLBACK;
}

/**
 * The registered dashboard behaviour for `field`, or `undefined` when only the generic fallback applies.
 * A form uses it to decide whether a locked field can render a real disabled control.
 */
export function registeredFieldType(field: DashboardField): FieldType | undefined {
  const fieldType = isNull(field.type) ? undefined : registry.get(field.type);
  if (!isUndefined(fieldType)) return fieldType;
  if (field.kind === 'column') {
    const primitive = PRIMITIVES[field.logicalType ?? ''];
    return isUndefined(primitive) ? undefined : registry.get(primitive);
  }
  return undefined;
}

const PRIMITIVES: Readonly<Record<string, string>> = {
  text: 'text',
  integer: 'integer',
  real: 'number',
  boolean: 'boolean',
};

/**
 * A dim placeholder mark, shared by cells for absent and summarized values.
 */
export function dimMark(text: string): Child {
  return h('span', { class: 'cell-dim' }, text);
}

/**
 * The element ids a control and its row derive from the field's path.
 * The row wires its label and description to them.
 * The control's input points back with `aria-labelledby` and `aria-describedby`.
 * The pair therefore stays associated without a `label[for]`.
 */
export function controlIDs(path: string): {
  row: string;
  input: string;
  label: string;
  description: string;
} {
  return {
    row: `field-${path}`,
    input: `field-${path}-input`,
    label: `field-${path}-label`,
    description: `field-${path}-desc`,
  };
}

css`
  .ohne-field-missing {
    --ohne-line-height: 1.5em;
    margin-top: 0.5rem;
  }
`;

const FALLBACK: FieldType = {
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
  control({ field, initial }) {
    const t = useT();
    const type = field.type ?? field.kind;
    let base = initial;
    const routed = ref('');

    const content = prose(
      () => {
        const flow = h('div', null);
        renderProse(flow, t('dashboard.field.missing.body', { type }));
        return [
          ...flow.children,
          h('pre', null, h('code', null, `registerFieldType('${type}', { ... })`)),
        ];
      },
      { spacing: -3 },
    );
    content.classList.add('ohne-field-missing');
    const element = alert(content, {
      title: t('dashboard.field.missing.title'),
      icon: icon('barrier-block'),
    });
    element.tabIndex = -1;

    return {
      element,
      // The stored value rides through, so a whole-item write never blanks an uneditable field.
      read() {
        return isUndefined(base) ? {} : { value: base };
      },
      setErrors(errors) {
        routed.value = errors[''] ?? '';
        for (const [key, message] of Object.entries(errors)) {
          if (key !== '') return message;
        }
        return '';
      },
      error() {
        return routed.value;
      },
      dirty() {
        return false;
      },
      focus() {
        element.focus();
      },
      revert() {
        routed.value = '';
      },
      rebase(value) {
        base = value;
        routed.value = '';
      },
    };
  },
};

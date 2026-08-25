import type { Child } from '../render/insert.ts';
import type { DashboardField } from '../runtime/meta-types.ts';

import { isUndefined } from '../../utils/is/is-undefined.ts';
import { batchedEffect } from '../../utils/reactive/batched-effect.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { useT } from '../runtime/use-t.ts';
import { button } from '../ui/button.ts';
import { icon } from '../ui/icon.ts';
import { controlIDs } from './field-type.ts';

/**
 * Options for `fieldRow`.
 */
export interface FieldRowOptions {
  /**
   * The field the row presents; drives the label, the required mark, and the metadata chips.
   */
  field: DashboardField;

  /**
   * The field's path from the record root; derives the row's element ids for label and deep links.
   */
  path: string;

  /**
   * Reactive dirty flag; while set, the row shows the accent dot and the revert affordance.
   */
  dirty?: () => boolean;

  /**
   * Reverts the control to its baseline; rendered as a ghost undo button while dirty.
   */
  onRevert?: () => void;

  /**
   * The reactive error line under the control; space is reserved so appearing never shifts layout.
   */
  error?: () => Child;

  /**
   * Focuses the control; wired to a click on the label text.
   */
  onLabelClick?: () => void;

  /**
   * Renders the locked chip, for immutable and read-only rows.
   */
  locked?: boolean;
}

css`
  .ohne-fieldrow + .ohne-fieldrow {
    margin-top: var(--s4);
  }

  .ohne-fieldrow-head {
    display: flex;
    align-items: center;
    gap: var(--s2);
    min-height: 16px;
    margin-bottom: 5px;
  }

  .ohne-fieldrow-label {
    font-size: var(--fs-small);
    font-weight: 500;
    color: var(--dim);
    cursor: default;
  }

  .ohne-fieldrow-head .ohne-caps {
    border: 1px solid var(--line);
    border-radius: 3px;
    padding: 1px 5px;
  }

  .ohne-fieldrow-dot {
    width: 5px;
    height: 5px;
    flex: none;
    border-radius: 50%;
    background: var(--accent);
  }

  .ohne-fieldrow-head .ohne-button {
    height: 18px;
  }

  .ohne-fieldrow-tail {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: var(--s2);
  }

  .ohne-fieldrow-desc {
    margin: -2px 0 6px;
    font-size: var(--fs-small);
    color: var(--dim);
  }

  .ohne-fieldrow-error {
    display: block;
    margin-top: 5px;
    font-size: var(--fs-small);
    color: var(--danger);
    min-height: 1em;
  }
`;

/**
 * Wires a control's focusable element to its row: id, label, description, and the invalid mark.
 * Call it once with the element a control wants the row's label to address.
 *
 * @example
 * ```ts
 * const input = textInput(raw)
 * describeControl(input, field, path, () => error())
 * ```
 */
export function describeControl(
  element: HTMLElement,
  field: DashboardField,
  path: string,
  error?: () => string,
): void {
  const ids = controlIDs(path);
  element.id = ids.input;
  element.setAttribute('aria-labelledby', ids.label);
  if (!isUndefined(field.description)) element.setAttribute('aria-describedby', ids.description);
  if (!isUndefined(error)) {
    batchedEffect(() => {
      if (error() === '') element.removeAttribute('aria-invalid');
      else element.setAttribute('aria-invalid', 'true');
    });
  }
}

/**
 * One form row: label and metadata above the control, the error line reserved beneath.
 * The dirty dot and the revert affordance appear only while the control differs from its baseline.
 * The row's root carries `field-<path>` as its id, so a `#field-<name>` hash can land on it.
 */
export function fieldRow(options: FieldRowOptions, control: Child): Child {
  const t = useT();
  const { field } = options;
  const ids = controlIDs(options.path);
  return h(
    'div',
    { class: 'ohne-fieldrow', id: ids.row },
    h(
      'div',
      { class: 'ohne-fieldrow-head' },
      h(
        'span',
        { class: 'ohne-fieldrow-label', id: ids.label, onClick: () => options.onLabelClick?.() },
        field.required ? `${field.label} *` : field.label,
      ),
      field.unique ? h('span', { class: 'ohne-caps' }, () => t('dashboard.field.unique')) : null,
      field.translatable
        ? h('span', { class: 'ohne-caps' }, () => t('dashboard.field.i18n'))
        : null,
      options.locked === true
        ? h('span', { class: 'ohne-caps' }, () => t('dashboard.field.locked'))
        : null,
      h(
        'div',
        { class: 'ohne-fieldrow-tail' },
        () => (options.dirty?.() === true ? h('span', { class: 'ohne-fieldrow-dot' }) : null),
        () =>
          options.dirty?.() === true && !isUndefined(options.onRevert)
            ? button(icon('arrow-back-up'), {
                variant: 'ghost',
                onClick: options.onRevert,
                ariaLabel: t('dashboard.field.revert'),
              })
            : null,
      ),
    ),
    isUndefined(field.description)
      ? null
      : h('div', { class: 'ohne-fieldrow-desc', id: ids.description }, field.description),
    control,
    isUndefined(options.error) ? null : h('span', { class: 'ohne-fieldrow-error' }, options.error),
  );
}

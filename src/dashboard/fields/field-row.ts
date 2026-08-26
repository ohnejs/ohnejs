import type { Child } from '../render/insert.ts';
import type { DashboardField } from '../runtime/meta-types.ts';

import { isUndefined } from '../../utils/is/is-undefined.ts';
import { batchedEffect } from '../../utils/reactive/batched-effect.ts';
import { onCleanup } from '../../utils/reactive/effect-scope.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { when } from '../render/when.ts';
import { useT } from '../runtime/use-t.ts';
import { fieldLabel } from '../ui/field-label.ts';
import { fieldMessage } from '../ui/field-message.ts';
import { field } from '../ui/field.ts';
import { icon } from '../ui/icon.ts';
import { attachTooltip } from '../ui/tooltip.ts';
import { controlIDs } from './field-type.ts';

/**
 * Options for `fieldRow`.
 */
export interface FieldRowOptions {
  /**
   * The field the row presents; drives the label, the required mark, and the metadata marks.
   */
  field: DashboardField;

  /**
   * The field's path from the record root; derives the row's element ids for label and deep links.
   */
  path: string;

  /**
   * Reactive dirty flag; while set, the row shows the dot and the revert affordance.
   */
  dirty?: () => boolean;

  /**
   * Reverts the control to its baseline; rendered as a muted undo mark while dirty.
   */
  onRevert?: () => void;

  /**
   * The control's reactive message; while non-empty it renders destructive in place of the description.
   */
  error?: () => string;

  /**
   * Focuses the control; wired to a click on the label text.
   */
  onLabelClick?: () => void;

  /**
   * Renders the locked mark, for immutable and read-only rows.
   */
  locked?: boolean;
}

css`
  .ohne-fieldrow .ohne-label {
    cursor: default;
  }

  .ohne-field-label .ohne-fieldrow-meta {
    display: flex;
    font-size: 1em;
  }

  .ohne-field-label .ohne-fieldrow-revert {
    color: hsl(var(--ohne-muted-foreground));
  }

  .ohne-field-label .ohne-fieldrow-revert:hover {
    color: hsl(var(--ohne-foreground));
  }

  .ohne-fieldrow-dot {
    flex: none;
    align-self: center;
    width: 0.3125rem;
    height: 0.3125rem;
    border-radius: 50%;
    background-color: hsl(var(--ohne-primary));
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
 * One form row rendered through the field primitives: the label row, the control, the message.
 * The label carries the required mark.
 * The metadata marks, the dirty dot, and the revert affordance sit at the row's right edge.
 * The message under the control shows the description muted, or the error destructive in its place.
 * The row's root carries `field-<path>` as its id, so a `#field-<name>` hash can land on it.
 */
export function fieldRow(options: FieldRowOptions, control: Child): Child {
  const t = useT();
  const ids = controlIDs(options.path);
  const failure = (): string => options.error?.() ?? '';

  const languageMark = (): HTMLElement => {
    const mark = h('span', { class: 'ohne-fieldrow-meta ohne-muted' }, icon('language'));
    onCleanup(attachTooltip(mark, () => t('dashboard.field.translatable')));
    return mark;
  };

  const head = fieldLabel(
    [
      h(
        'span',
        { class: 'ohne-label', id: ids.label, onClick: () => options.onLabelClick?.() },
        options.field.label,
      ),
      options.field.unique
        ? h('span', { class: 'ohne-muted' }, () => t('dashboard.field.unique'))
        : null,
      options.field.translatable ? languageMark() : null,
      options.locked === true
        ? h('span', { class: 'ohne-muted' }, () => t('dashboard.field.locked'))
        : null,
      () => (options.dirty?.() === true ? h('span', { class: 'ohne-fieldrow-dot' }) : null),
      () =>
        options.dirty?.() === true && !isUndefined(options.onRevert)
          ? h(
              'button',
              {
                class: 'ohne-fieldrow-meta ohne-fieldrow-revert',
                type: 'button',
                'aria-label': () => t('dashboard.field.revert'),
                onClick: () => options.onRevert?.(),
              },
              icon('arrow-back-up'),
            )
          : null,
    ],
    { required: options.field.required },
  );

  const message =
    isUndefined(options.error) && isUndefined(options.field.description)
      ? null
      : when(
          () => failure() !== '' || !isUndefined(options.field.description),
          () =>
            fieldMessage(
              () => {
                const current = failure();
                if (current !== '') return h('p', null, current);
                return h('p', { id: ids.description }, options.field.description);
              },
              { error: () => failure() !== '' },
            ),
        );

  const row = field([head, control, message], { class: 'ohne-fieldrow' });
  row.id = ids.row;
  return row;
}

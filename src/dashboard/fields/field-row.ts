import type { Child } from '../render/insert.ts';
import type { DashboardField } from '../runtime/meta-types.ts';

import { isUndefined } from '../../utils/is/is-undefined.ts';
import { batchedEffect } from '../../utils/reactive/batched-effect.ts';
import { onCleanup } from '../../utils/reactive/effect-scope.ts';
import { ref } from '../../utils/reactive/ref.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { append } from '../render/insert.ts';
import { when } from '../render/when.ts';
import { dashboardMeta } from '../runtime/meta.ts';
import { useT } from '../runtime/use-t.ts';
import { fieldLabel } from '../ui/field-label.ts';
import { fieldMessage } from '../ui/field-message.ts';
import { field } from '../ui/field.ts';
import { icon } from '../ui/icon.ts';
import { renderProse } from '../ui/prose.ts';
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
   * Reactive dirty flag; while set, the row shows the touched dot at its right edge.
   */
  dirty?: () => boolean;

  /**
   * Reverts the control to its baseline.
   * While dirty, the touched dot doubles as this action: hover or focus morphs it into an undo mark.
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

  /**
   * Overrides the locked mark's tooltip with a more specific reason.
   */
  lockedHint?: () => string;

  /**
   * Receives the metadata marks in place of the label row, for a control that shows its own label.
   */
  marks?: HTMLElement;
}

css`
  .ohne-fieldrow .ohne-label {
    cursor: default;
  }

  .ohne-field-label .ohne-fieldrow-name {
    flex: 1 1 0;
    display: flex;
    align-items: center;
    gap: 0.375em;
    max-width: max-content;
    margin-right: auto;
    font-size: 1em;
  }

  .ohne-field-label .ohne-fieldrow-unique {
    flex: none;
    padding: 0.125em 0.4375em;
    border-radius: calc(var(--ohne-radius) - 0.25rem);
    background-color: hsl(var(--ohne-muted));
    color: hsl(var(--ohne-muted-foreground));
    font-size: calc(1em - 0.3125rem);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .ohne-field-label .ohne-fieldrow-meta {
    display: flex;
    font-size: 1em;
  }

  .ohne-fieldrow-touched {
    flex: none;
    position: relative;
    display: flex;
    justify-content: center;
    align-items: center;
    width: 1.25em;
    width: round(1.25em, 1px);
    height: 1.25em;
    height: round(1.25em, 1px);
  }

  .ohne-fieldrow-pristine {
    display: none;
  }

  .ohne-fieldrow-dot {
    width: 0.3125rem;
    height: 0.3125rem;
    border-radius: 50%;
    background-color: hsl(var(--ohne-primary) / 0.64);
    transition: var(--ohne-transition);
    transition-property: opacity;
  }

  .ohne-fieldrow-revert::before {
    content: '';
    position: absolute;
    inset: -0.25em;
  }

  .ohne-fieldrow-revert svg {
    position: absolute;
    opacity: 0;
    color: hsl(var(--ohne-foreground));
    transition: var(--ohne-transition);
    transition-property: opacity;
  }

  .ohne-fieldrow-revert:is(:hover, :focus-visible) svg {
    opacity: 1;
  }

  .ohne-fieldrow-revert:is(:hover, :focus-visible) .ohne-fieldrow-dot {
    opacity: 0;
  }

  .ohne-field-description-toggle {
    display: flex;
    gap: 0.25rem;
    padding: 0;
    border-radius: min(var(--ohne-radius), 0.125rem);
    background: none;
    color: inherit;
    text-decoration: none;
    cursor: pointer;
  }

  .ohne-field-description-toggle > svg {
    margin-top: 0.0825rem;
    transition: var(--ohne-transition);
    transition-property: transform;
  }

  .ohne-field-description-toggle:focus-visible {
    box-shadow:
      0 0 0 0.125rem hsl(var(--ohne-background)),
      0 0 0 0.25rem hsl(var(--ohne-ring)),
      0 0 #0000;
    outline: 0.125rem solid transparent;
    outline-offset: 0.125rem;
  }

  .ohne-field-description-expanded > svg {
    transform: rotate(90deg);
  }

  .ohne-field-description-content {
    margin: 0.25rem 0 0 calc(1em + 0.0625rem + 0.25rem);
  }
`;

/**
 * Wires a control's focusable element to its row: id, label, description, and the invalid mark.
 * Call it once with the element a control wants the row's label to address.
 *
 * @example
 * ```ts
 * const input = textInput(raw).querySelector('input') as HTMLInputElement
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
  // The error paragraph reuses the description id, so the reference also serves errored controls.
  if (!isUndefined(field.description) || !isUndefined(field.expandable) || !isUndefined(error)) {
    element.setAttribute('aria-describedby', ids.description);
  }
  if (!isUndefined(error)) {
    batchedEffect(() => {
      if (error() === '') element.removeAttribute('aria-invalid');
      else element.setAttribute('aria-invalid', 'true');
    });
  }
}

/**
 * One form row rendered through the field primitives: the label row, the control, the message.
 * The label carries the required mark, and a unique field pairs it with the unique chip.
 * With `marks`, the control shows its own label and the row hands it the metadata glyphs instead.
 * The metadata glyphs sit at the row's right edge, and a dirty row's touched dot takes it from them.
 * With `onRevert`, the dot is a button that morphs into an undo mark on hover or focus.
 * The message under the control shows the description as prose, or the error destructive in its place.
 * An expandable description sits behind a chevron toggle that reads its show or hide label.
 * The row's root carries `field-<path>` as its id, so a `#field-<name>` hash can land on it.
 */
export function fieldRow(options: FieldRowOptions, control: Child): Child {
  const t = useT();
  const ids = controlIDs(options.path);
  const failure = (): string => options.error?.() ?? '';
  // Declared outside the message region, so an error swap keeps the toggle's state.
  const expanded = ref(options.field.expandable?.expanded ?? false);

  const languageMark = (): HTMLElement => {
    const mark = h('span', { class: 'ohne-fieldrow-meta ohne-muted' }, icon('language'));
    onCleanup(attachTooltip(mark, () => t('dashboard.field.translatable')));
    return mark;
  };

  const lockMark = (): HTMLElement => {
    const mark = h('span', { class: 'ohne-fieldrow-meta ohne-muted' }, icon('lock'));
    onCleanup(attachTooltip(mark, options.lockedHint ?? (() => t('dashboard.field.locked'))));
    return mark;
  };

  // Mounted once and hidden while pristine, so one tooltip outlives every dirt toggle.
  const touchedMark = (): Child => {
    if (isUndefined(options.dirty)) return null;
    const box = (): string =>
      `ohne-fieldrow-touched${options.dirty?.() === true ? '' : ' ohne-fieldrow-pristine'}`;
    const dot = h('span', { class: 'ohne-fieldrow-dot' });
    if (isUndefined(options.onRevert)) return h('span', { class: box }, dot);
    const revert = h(
      'button',
      {
        class: () => `${box()} ohne-fieldrow-revert`,
        type: 'button',
        'aria-label': () => t('dashboard.field.revert'),
        onClick: () => options.onRevert?.(),
      },
      dot,
      icon('arrow-back-up'),
    );
    onCleanup(attachTooltip(revert, () => t('dashboard.field.revert')));
    return revert;
  };

  const label = h(
    'span',
    { class: 'ohne-label', id: ids.label, onClick: () => options.onLabelClick?.() },
    options.field.label,
  );

  const name = options.field.unique
    ? h(
        'span',
        { class: 'ohne-fieldrow-name' },
        label,
        h('span', { class: 'ohne-fieldrow-unique' }, () => t('dashboard.field.unique')),
      )
    : label;

  const extras: Child[] = [
    options.field.translatable
      ? when(() => (dashboardMeta()?.locales.length ?? 0) > 1, languageMark)
      : null,
    options.locked === true ? lockMark() : null,
    touchedMark(),
  ];

  let head: Child = null;
  if (isUndefined(options.marks)) {
    head = fieldLabel([name, ...extras], { required: options.field.required });
  } else {
    // The control outlives a form's re-render, so its slot drops the previous row's marks first.
    options.marks.replaceChildren();
    append(options.marks, extras);
  }

  const proseBlock = (text: string, className = 'ohne-prose'): HTMLElement => {
    const flow = h('div', { class: className, id: ids.description });
    renderProse(flow, text);
    return flow;
  };

  const expandableDescription = (expandable: NonNullable<DashboardField['expandable']>): Child => [
    h(
      'button',
      {
        type: 'button',
        class: () =>
          `ohne-field-description-toggle ohne-raw${expanded.value ? ' ohne-field-description-expanded' : ''}`,
        'aria-expanded': () => String(expanded.value),
        onClick: () => {
          expanded.value = !expanded.value;
        },
      },
      icon('chevron-right'),
      h('span', null, () => (expanded.value ? expandable.hideLabel : expandable.showLabel)),
    ),
    when(
      () => expanded.value,
      () => proseBlock(expandable.text, 'ohne-prose ohne-field-description-content'),
    ),
  ];

  const described =
    !isUndefined(options.field.description) || !isUndefined(options.field.expandable);

  const message =
    isUndefined(options.error) && !described
      ? null
      : when(
          () => failure() !== '' || described,
          () =>
            fieldMessage(
              () => {
                const current = failure();
                if (current !== '') return h('p', { id: ids.description }, current);
                const { description, expandable } = options.field;
                if (!isUndefined(expandable)) return expandableDescription(expandable);
                if (!isUndefined(description)) return proseBlock(description);
                return null;
              },
              { error: () => failure() !== '' },
            ),
        );

  const row = field([head, control, message], { class: 'ohne-fieldrow' });
  row.id = ids.row;
  return row;
}

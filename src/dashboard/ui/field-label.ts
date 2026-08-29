import type { Child } from '../render/insert.ts';

import { isUndefined } from '../../utils/is/is-undefined.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { dispatchTrigger } from './trigger.ts';
import './tokens.ts';

/**
 * Options for `fieldLabel`.
 */
export interface FieldLabelOptions {
  /**
   * Size step of the component: -2 very small, -1 small, 0 default, 1 large, 2 very large.
   * Omitted inherits `--ohne-size` from the nearest ancestor.
   */
  size?: number;

  /**
   * Marks the field as required, showing an asterisk after the label.
   *
   * @default
   * false
   */
  required?: boolean;
}

css`
  .ohne-field-label {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    row-gap: 0.5em;
    row-gap: round(0.5em, 1px);
    column-gap: 1em;
    width: 100%;
    max-width: 100%;
    font-size: calc(1rem + var(--ohne-size) * 0.0625rem);
  }

  /* Flex collects lines from max-content widths before it flexes, so an unflexed label would take
     the row alone and push the extras onto a second one. The zero basis hides it from that step;
     the cap keeps its box on its text, so the auto margin still holds the extras at the edge. */
  .ohne-field-label :where(label, .ohne-label) {
    flex: 1 1 0;
    max-width: max-content;
    margin-right: auto;
    overflow: hidden;
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* The mark floats out of the inline flow, so the ellipsis trims the text and never the mark.
     It generates before the text because a float trailing a full line has no room and drops. */
  .ohne-field-label-required :where(label, .ohne-label)::before {
    content: '*';
    float: right;
    margin-left: 0.125em;
    margin-left: round(0.125em, 1px);
    color: hsl(var(--ohne-destructive));
  }

  .ohne-field-label p {
    width: 100%;
    color: hsl(var(--ohne-muted-foreground));
    font-size: calc(1em - 0.25rem);
    line-height: 1.25;
    line-height: round(calc(1.25 * 1em), 1px);
  }

  .ohne-field-label :not(p) {
    font-size: calc(1em - 0.125rem);
    line-height: 1.25;
    line-height: round(calc(1.25 * 1em), 1px);
  }

  .ohne-field-label svg {
    font-size: calc(1em - 0.0625rem);
  }
`;

/**
 * The label row above a control.
 * The content is a `<label for>` or an `.ohne-label` span, with optional trailing extras.
 * The extras are pushed to the right edge, and an optional `<p>` description wraps onto its own row.
 * The label is the only part that gives way, trimming to one line.
 * The required mark and every trailing extra keep their size beside it.
 * A click on `label[for]` dispatches `focus:<for>` on the trigger bus, so a non-native widget focuses itself.
 * Native inputs are focused by the browser's own `label[for]` handling.
 *
 * @example
 * ```ts
 * fieldLabel(h('label', { for: 'email' }, 'Email'), { required: true })
 * ```
 */
export function fieldLabel(
  content: Child | (() => Child),
  options: FieldLabelOptions = {},
): HTMLElement {
  return h(
    'div',
    {
      class: `ohne-field-label${options.required ? ' ohne-field-label-required' : ''}`,
      style: isUndefined(options.size) ? undefined : `--ohne-size: ${options.size}`,
      onClick: (event: MouseEvent) => {
        if (event.target instanceof HTMLLabelElement && event.target.hasAttribute('for')) {
          dispatchTrigger(`focus:${event.target.getAttribute('for')}`);
        }
      },
    },
    content,
  );
}

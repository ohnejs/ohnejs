import type { Child } from '../render/insert.ts';

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

  .ohne-field-label :where(label, .ohne-label) {
    margin-right: auto;
    overflow: hidden;
    font-weight: 500;
    text-overflow: ellipsis;
  }

  .ohne-field-label-required :where(label, .ohne-label)::after {
    content: '*';
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
 * The content is a `<label for>` or an `.ohne-label` span, optional trailing extras pushed to the
 * right edge, and an optional `<p>` description that wraps onto its own row.
 * A click on a `label[for]` dispatches `focus:<for>` on the trigger bus, so a non-native widget can
 * focus itself; native inputs are focused by the browser's own `label[for]` handling.
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
      style: options.size === undefined ? undefined : `--ohne-size: ${options.size}`,
      onClick: (event: MouseEvent) => {
        if (event.target instanceof HTMLLabelElement && event.target.hasAttribute('for')) {
          dispatchTrigger(`focus:${event.target.getAttribute('for')}`);
        }
      },
    },
    content,
  );
}

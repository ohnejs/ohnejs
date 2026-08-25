import type { Child } from '../render/insert.ts';

import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { when } from '../render/when.ts';
import { icon } from './icon.ts';
import './tokens.ts';

/**
 * Options for `fieldMessage`.
 */
export interface FieldMessageOptions {
  /**
   * Size step of the component: -2 very small, -1 small, 0 default, 1 large, 2 very large.
   * Omitted inherits `--ohne-size` from the nearest ancestor.
   */
  size?: number;

  /**
   * Reports the error state reactively.
   * While it returns `true` the text turns destructive and an error icon leads it.
   */
  error?: () => boolean;
}

css`
  .ohne-field-message {
    display: flex;
    gap: 0.375em;
    max-width: 100%;
    font-size: calc(1rem + var(--ohne-size) * 0.0625rem);
    color: hsl(var(--ohne-muted-foreground));
  }

  .ohne-field-message-has-errors {
    color: hsl(var(--ohne-destructive));
    font-weight: 500;
  }

  .ohne-field-message-inner {
    font-size: calc(1em - 0.125rem);
    line-height: 1.25;
    line-height: round(calc(1.25 * 1em), 1px);
  }

  .ohne-field-message-inner .ohne-prose {
    font-size: 1em;
    line-height: 1.25;
    line-height: round(calc(1.25 * 1em), 1px);
  }

  .ohne-field-message-inner .ohne-prose :where(*) {
    margin-top: 0;
  }

  .ohne-field-message-inner .ohne-prose :where(ul, ol) {
    padding-inline-start: 1em;
  }

  .ohne-field-message-inner .ohne-prose :where(:not(pre)) :where(code) {
    padding: 0;
    background-color: transparent;
    border-radius: 0;
    color: hsl(var(--ohne-foreground));
    font-size: 1em;
  }

  .ohne-field-message-inner .ohne-prose :where(table) {
    width: auto;
  }

  .ohne-field-message-inner .ohne-prose :where(tr) {
    border-bottom-width: 0;
  }

  .ohne-field-message-inner .ohne-prose :where(th, td) {
    padding: 0;
  }

  .ohne-field-message-inner .ohne-prose :where(th, td):not(:last-child) {
    padding-right: 1em;
  }

  .ohne-field-message svg {
    margin-top: -0.5px;
    font-size: calc(1em + 0.0625rem);
    flex-shrink: 0;
  }
`;

/**
 * The helper or error text under a control.
 * Muted by default; in the error state it turns destructive, bolds, and leads with an error icon.
 * It has no show or hide animation of its own - consumers toggle it and the field reflows.
 *
 * @example
 * ```ts
 * fieldMessage('Use your work address')
 * fieldMessage(() => errors.email.value, { error: () => true })
 * ```
 */
export function fieldMessage(
  content: Child | (() => Child),
  options: FieldMessageOptions = {},
): HTMLElement {
  const error = (): boolean => options.error?.() ?? false;
  return h(
    'div',
    {
      class: () => `ohne-field-message${error() ? ' ohne-field-message-has-errors' : ''}`,
      style: options.size === undefined ? undefined : `--ohne-size: ${options.size}`,
    },
    when(error, () => icon('exclamation-circle-filled')),
    h('div', { class: 'ohne-field-message-inner' }, content),
  );
}

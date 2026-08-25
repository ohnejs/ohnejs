import type { Child } from '../render/insert.ts';

import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import './tokens.ts';

/**
 * Options for `field`.
 */
export interface FieldOptions {
  /**
   * Size step of the component: -2 very small, -1 small, 0 default, 1 large, 2 very large.
   * Omitted inherits `--ohne-size` from the nearest ancestor.
   */
  size?: number;

  /**
   * Extra class names appended to the field's own.
   * `ohne-field-narrow` tightens the rhythm to a preceding field.
   */
  class?: string;
}

css`
  .ohne-field {
    width: 100%;
    font-size: calc(1rem + var(--ohne-size) * 0.125rem);
  }

  .ohne-field:not([hidden]) + .ohne-field:not([hidden]) {
    margin-top: calc(1em + 0.125rem);
  }

  .ohne-field:not([hidden]) + .ohne-field-narrow:not([hidden]) {
    margin-top: calc(0.5em + 0.125rem);
  }

  .ohne-field > * + * {
    margin-top: 0.5em;
  }
`;

/**
 * The vertical stack around a label, a control, and a message.
 * It owns the size cascade and the spacing between its children and between sibling fields.
 * The content is the whole structure; the wrapper adds none of its own.
 *
 * @example
 * ```ts
 * field([fieldLabel(h('label', { for: 'email' }, 'Email')), textInput(email, { id: 'email' })])
 * ```
 */
export function field(content: Child | (() => Child), options: FieldOptions = {}): HTMLElement {
  return h(
    'div',
    {
      class: `ohne-field${options.class ? ` ${options.class}` : ''}`,
      style: options.size === undefined ? undefined : `--ohne-size: ${options.size}`,
    },
    content,
  );
}

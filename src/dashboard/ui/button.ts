import type { Child } from '../render/insert.ts';

import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import './tokens.ts';

/**
 * Options for `button`.
 */
export interface ButtonOptions {
  /**
   * The visual weight: `solid` is the one accent action, `ghost` a quiet inline one.
   *
   * @default
   * 'solid'
   */
  kind?: 'solid' | 'ghost';

  /**
   * Extra class names appended to the button's own.
   */
  class?: string;

  /**
   * The button's form role.
   *
   * @default
   * 'button'
   */
  type?: 'button' | 'submit';

  /**
   * Disables the button reactively while the condition holds.
   */
  disabled?: () => boolean;

  /**
   * Click handler; a `submit` button inside a form submits through the form instead.
   */
  onClick?: (event: MouseEvent) => void;
}

css`
  .ohne-button {
    appearance: none;
    border: 1px solid transparent;
    font: inherit;
    cursor: pointer;
    padding: 6px 14px;
    transition: opacity var(--pace);
  }

  .ohne-button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .ohne-button.solid {
    background: var(--accent);
    color: var(--accent-ink);
  }

  .ohne-button.ghost {
    background: none;
    color: var(--dim);
    padding: 6px 0;
  }

  .ohne-button.ghost:hover:not(:disabled) {
    color: var(--ink);
  }

  .ohne-button.solid:hover:not(:disabled) {
    opacity: 0.85;
  }
`;

/**
 * A Ledger button: a flat accent block or a quiet ghost, no radius, no shadow.
 *
 * @example
 * ```ts
 * button(() => t('dashboard.login.submit'), { type: 'submit' })
 * ```
 */
export function button(label: Child | (() => Child), options: ButtonOptions = {}): HTMLElement {
  return h(
    'button',
    {
      class: `ohne-button ${options.kind ?? 'solid'}${options.class ? ` ${options.class}` : ''}`,
      type: options.type ?? 'button',
      disabled: options.disabled,
      onClick: options.onClick,
    },
    label,
  );
}

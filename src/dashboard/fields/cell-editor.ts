import type { CommitLanding } from './field-type.ts';

import { css } from '../render/css.ts';
import { h } from '../render/h.ts';

/**
 * Options for `cellEditor`.
 */
export interface CellEditorOptions {
  /**
   * The text the editor opens with, selected for immediate overtyping.
   */
  initial: string;

  /**
   * The input type.
   *
   * @default
   * 'text'
   */
  type?: 'text' | 'password';

  /**
   * Renders the text in the mono font, for identifiers.
   *
   * @default
   * false
   */
  mono?: boolean;

  /**
   * Takes the entered text on Enter or blur.
   * Return `false` to reject it as invalid: the editor stays open and marks itself.
   * Return the write's landing promise to re-arm Enter and blur when the write fails.
   */
  commit(text: string): boolean | void | Promise<CommitLanding>;

  /**
   * Called on Escape; the editor closes without writing.
   */
  cancel(): void;
}

css`
  .cell-editor {
    box-sizing: border-box;
    display: block;
    width: 100%;
    min-width: 140px;
    border: none;
    outline: none;
    background: hsl(var(--ohne-background));
    color: inherit;
    font: inherit;
    padding: 0 0.75rem;
    height: 100%;
    box-shadow: inset 0 0 0 1px hsl(var(--ohne-ring));
  }

  .cell-editor.invalid {
    color: hsl(var(--ohne-destructive));
  }
`;

/**
 * The sheet's inline text editor: fills its cell, commits on Enter or blur, cancels on Escape.
 * A rejected commit keeps the editor open and marks the text; typing clears the mark.
 * Custom field cells compose it for any text-shaped editing.
 *
 * @example
 * ```ts
 * cellEditor({
 *   initial: String(value() ?? ''),
 *   commit: (text) => commit(text),
 *   cancel,
 * })
 * ```
 */
export function cellEditor(options: CellEditorOptions): HTMLInputElement {
  const input = h('input', {
    class: `cell-editor${options.mono ? ' cell-mono' : ''}`,
    type: options.type ?? 'text',
  }) as HTMLInputElement;
  input.value = options.initial;

  let settled = false;
  const attempt = (): void => {
    if (settled) return;
    settled = true;
    const outcome = options.commit(input.value);
    if (outcome === false) {
      settled = false;
      input.classList.add('invalid');
    } else if (outcome instanceof Promise) {
      void outcome.then((landing) => {
        if (!landing.landed) settled = false;
      });
    }
  };

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      attempt();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      settled = true;
      options.cancel();
    }
  });
  input.addEventListener('input', () => {
    settled = false;
    input.classList.remove('invalid');
  });
  input.addEventListener('blur', attempt);

  queueMicrotask(() => {
    input.focus();
    input.select();
  });
  return input;
}

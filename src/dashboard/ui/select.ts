import type { Ref } from '../../utils/reactive/ref.ts';

import { batchedEffect } from '../../utils/reactive/batched-effect.ts';
import { css } from '../render/css.ts';
import { each } from '../render/each.ts';
import { h } from '../render/h.ts';
import './tokens.ts';

/**
 * One choice a `select` offers.
 */
export interface SelectOption {
  /**
   * The value written to the bound ref when the choice is picked.
   */
  value: string;

  /**
   * The text shown for the choice.
   */
  label: string;
}

css`
  .ohne-select {
    appearance: none;
    display: block;
    box-sizing: border-box;
    max-width: 100%;
    background: none;
    border: none;
    border-bottom: 1px solid var(--hairline);
    border-radius: 0;
    color: inherit;
    font: inherit;
    padding: 4px 16px 4px 0;
    transition: border-color var(--pace);
  }

  .ohne-select:focus {
    outline: none;
    border-bottom-color: var(--accent);
  }

  .ohne-select:disabled {
    color: var(--dim);
  }
`;

/**
 * A Ledger select: the same hairline underline a text input wears, bound two-way to `value`.
 *
 * The native control keeps the platform's keyboard and assistive behaviour.
 * The sheet already treats a `select` as interactive, so its keys never reach the grid.
 * `options` is read reactively, so a changing set of choices re-renders in place.
 * The element is returned directly, so a caller can focus it.
 *
 * @example
 * ```ts
 * const type = ref('Hero')
 * select(type, () => [
 *   { value: 'Hero', label: 'Hero' },
 *   { value: 'Quote', label: 'Quote' },
 * ])
 * ```
 */
export function select(
  value: Ref<string>,
  options: () => readonly SelectOption[],
  disabled?: () => boolean,
): HTMLSelectElement {
  const element = h(
    'select',
    { class: 'ohne-select', disabled: () => disabled?.() === true },
    each(
      options,
      (option) => option.value,
      (option) => h('option', { value: () => option().value }, () => option().label),
    ),
  ) as HTMLSelectElement;
  element.addEventListener('change', () => {
    value.value = element.value;
  });
  batchedEffect(() => {
    // Reading `options` subscribes the sync: a fresh set replaces the DOM options, and the
    // element would otherwise keep whatever the browser selected for it.
    options();
    if (element.value !== value.value) element.value = value.value;
  });
  return element;
}

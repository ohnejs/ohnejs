import type { Ref } from '../../utils/reactive/ref.ts';
import type { Child } from '../render/insert.ts';

import { batchedEffect } from '../../utils/reactive/batched-effect.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import './tokens.ts';

css`
  .ohne-checkbox {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
  }

  .ohne-checkbox-input {
    position: absolute;
    opacity: 0;
    width: 1px;
    height: 1px;
  }

  .ohne-checkbox-box {
    display: inline-grid;
    place-items: center;
    width: 16px;
    height: 16px;
    box-sizing: border-box;
    border: 1px solid var(--hairline);
    color: var(--accent);
    font-size: 12px;
    line-height: 1;
    transition: border-color var(--pace);
  }

  .ohne-checkbox-input:focus-visible + .ohne-checkbox-box {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .ohne-checkbox:hover .ohne-checkbox-box {
    border-color: var(--dim);
  }
`;

/**
 * A Ledger checkbox: a hairline square that takes an accent check, bound two-way to `value`.
 * The real input stays for keyboard and assistive tech; the square is its visual.
 *
 * @example
 * ```ts
 * const published = ref(false)
 * checkbox(published, () => t('dashboard.fields.published.label'))
 * ```
 */
export function checkbox(value: Ref<boolean>, label?: () => Child): Child {
  const input = h('input', { class: 'ohne-checkbox-input', type: 'checkbox' }) as HTMLInputElement;
  input.addEventListener('change', () => {
    value.value = input.checked;
  });
  batchedEffect(() => {
    if (input.checked !== value.value) input.checked = value.value;
  });
  return h(
    'label',
    { class: 'ohne-checkbox' },
    input,
    h('span', { class: 'ohne-checkbox-box' }, () => (value.value ? '✓' : '')),
    label ? h('span', null, label) : null,
  );
}

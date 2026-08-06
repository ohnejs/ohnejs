import type { Child } from '../render/insert.ts';

import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import './tokens.ts';

css`
  .ohne-field {
    display: block;
  }

  .ohne-field + .ohne-field {
    margin-top: 20px;
  }

  .ohne-field .ohne-caps {
    display: block;
    margin-bottom: 2px;
  }

  .ohne-field-error {
    display: block;
    margin-top: 4px;
    font-size: 12px;
    color: var(--danger);
    min-height: 1em;
  }
`;

/**
 * A labeled form row: a small-caps label above its control, with an optional error line beneath.
 * The row is a `label` element, so clicking the text focuses the control.
 *
 * @example
 * ```ts
 * labeledField(() => t('dashboard.login.email'), textInput(email, { type: 'email' }))
 * ```
 */
export function labeledField(label: () => Child, control: Child, error?: () => Child): Child {
  return h(
    'label',
    { class: 'ohne-field' },
    h('span', { class: 'ohne-caps' }, label),
    control,
    error ? h('span', { class: 'ohne-field-error' }, error) : null,
  );
}

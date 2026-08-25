import type { Child } from '../render/insert.ts';

import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import './tokens.ts';

css`
  .ohne-field {
    display: block;
  }

  .ohne-field + .ohne-field {
    margin-top: var(--s4);
  }

  .ohne-labeled-field-label {
    display: block;
    font-size: var(--fs-small);
    font-weight: 500;
    color: var(--dim);
    margin-bottom: 5px;
  }

  .ohne-field-error {
    display: block;
    margin-top: 5px;
    font-size: var(--fs-small);
    color: var(--danger);
    min-height: 1em;
  }
`;

/**
 * A labeled form row: the label above its control, with an optional error line beneath.
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
    h('span', { class: 'ohne-labeled-field-label' }, label),
    control,
    error ? h('span', { class: 'ohne-field-error' }, error) : null,
  );
}

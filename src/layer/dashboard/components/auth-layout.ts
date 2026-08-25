import { base, type Child, css, h } from 'ohne/dashboard';

import { wrapper } from './wrapper.ts';

css`
  .o-auth-layout {
    width: 100%;
    max-width: 24rem;
    margin: auto -1rem;
    padding: 0.5rem 0;
  }

  .o-auth-header,
  .o-auth-footer {
    min-height: 1.875rem;
    padding: 0 1.5rem;
  }

  .o-auth-main {
    padding: 1rem 1.5rem;
  }

  .o-auth-main hr {
    position: absolute;
    left: 0;
  }

  .o-auth-main hr:first-child {
    margin-top: -0.5rem;
  }

  .o-auth-main hr:last-child {
    margin-top: 0.5rem;
  }

  .o-auth-slot {
    position: relative;
    z-index: 1;
  }
`;

/**
 * The narrow centered layout for the auth screens: login, install, logout.
 * The header holds the watermark logo.
 * The main section draws two full-width divider lines above and below the card.
 * They span the wrapper between the rails.
 * The footer balances the header, so the card centers vertically.
 */
export function authLayout(header: Child, ...children: Child[]): HTMLElement {
  return base(layout(header, children));
}

function layout(header: Child, children: Child[]): HTMLElement {
  return wrapper(
    h(
      'div',
      { class: 'o-auth-layout' },
      h('div', { class: 'o-auth-header' }, header),
      h(
        'div',
        { class: 'o-auth-main' },
        h('hr'),
        h('div', { class: 'o-auth-slot' }, children),
        h('hr'),
      ),
      h('div', { class: 'o-auth-footer' }),
    ),
  );
}

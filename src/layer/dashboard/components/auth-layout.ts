import { base, type Child, css, h } from 'ohne/dashboard';

import { wrapper } from './wrapper.ts';

css`
  .o-layout {
    width: 100%;
    max-width: 24rem;
    margin: auto -1rem;
    padding: 0.5rem 0;
  }

  .o-header,
  .o-footer {
    min-height: 1.875rem;
    padding: 0 1.5rem;
  }

  .o-main {
    padding: 1rem 1.5rem;
  }

  .o-main hr {
    position: absolute;
    left: 0;
  }

  .o-main hr:first-child {
    margin-top: -0.5rem;
  }

  .o-main hr:last-child {
    margin-top: 0.5rem;
  }

  .o-slot {
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
      { class: 'o-layout' },
      h('div', { class: 'o-header' }, header),
      h('div', { class: 'o-main' }, h('hr'), h('div', { class: 'o-slot' }, children), h('hr')),
      h('div', { class: 'o-footer' }),
    ),
  );
}

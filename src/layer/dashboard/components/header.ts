import { button, css, h, icon, useT } from 'ohne/dashboard';
import { effect } from 'ohne/utils';

import { contentLanguageSwitcher } from './content-language-switcher.ts';
import { headerDropdownMenu } from './header-dropdown-menu.ts';
import { logo } from './logo.ts';
import { shellSlots } from './shell-slots.ts';

/**
 * Options for `header`.
 */
export interface HeaderOptions {
  /**
   * Whether the mobile sidebar overlay is expanded, read reactively.
   * The hamburger renders accented while it returns `true`.
   */
  sidebarExpanded: () => boolean;

  /**
   * Called when the hamburger asks to toggle the sidebar overlay.
   */
  onToggleSidebar: () => void;
}

css`
  .o-header-container {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.75rem;
    height: 100%;
    padding: 0 0.25rem;
  }

  .o-header-left {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .o-header-menu-button {
    display: none;
  }

  .o-header-right {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .o-header-logo {
    display: block;
    width: auto;
    height: 2.25rem;
    margin: -0.25rem;
    padding: 0.25rem;
    border-radius: calc(var(--ohne-radius) - 0.125rem);
    color: hsl(var(--ohne-card));
    filter: brightness(0.8);
    transition: var(--ohne-transition);
    transition-property: border-color, box-shadow;
  }

  .o-header-logo:focus-visible {
    box-shadow: 0 0 0 0.125rem hsl(var(--ohne-ring));
    outline: none;
  }

  .dark .o-header-logo {
    filter: brightness(1.5);
  }

  .o-header-logo > .o-logo {
    height: 100%;
  }

  @media (max-width: 1024px) {
    .o-header-container.o-has-sidebar .o-header-logo {
      display: none;
    }

    .o-header-menu-button {
      display: inline-flex;
    }

    .o-header-container :where(.ohne-button, .ohne-icon-group) {
      --ohne-size: -2;
    }
  }
`;

/**
 * The header row.
 * It holds the home logo link, the under-`1024px` hamburger, and the right-side cluster.
 * The logo rests as the dot and unfolds into the wordmark while the link is hovered or focused.
 * The cluster is the content-language switcher, the `header` slot renderers, and the kebab user menu.
 * The hamburger renders accented while the sidebar overlay is expanded, outline otherwise.
 */
export function header(options: HeaderOptions): HTMLElement {
  const t = useT();

  const mark = logo();
  const home = h(
    'a',
    {
      href: '/',
      title: t('dashboard.goBackHome'),
      class: 'o-header-logo ohne-raw',
      onMouseenter: () => mark.expand(),
      onMouseleave: () => mark.collapse(),
      onFocus: () => mark.expand(),
      onBlur: () => mark.collapse(),
    },
    mark.el,
  );

  const menuButton = button(icon('menu-2'), {
    variant: 'outline',
    class: 'o-header-menu-button',
    onClick: () => options.onToggleSidebar(),
  });
  menuButton.title = t('dashboard.header.toggleSidebar');
  effect(() => {
    const expanded = options.sidebarExpanded();
    menuButton.classList.toggle('ohne-button-accent', expanded);
    menuButton.classList.toggle('ohne-button-outline', !expanded);
  });

  return h(
    'div',
    { class: 'o-header-container o-has-sidebar' },
    h('div', { class: 'o-header-left' }, home, menuButton),
    h(
      'div',
      { class: 'o-header-right' },
      contentLanguageSwitcher(),
      shellSlots('header').map((render) => render()),
      headerDropdownMenu(),
    ),
  );
}

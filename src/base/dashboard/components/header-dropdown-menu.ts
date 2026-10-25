import {
  button,
  dashboardMeta,
  menu,
  resolvedColorMode,
  setColorMode,
  useT,
} from 'ohnejs/dashboard';

/**
 * The header's kebab user menu.
 * The first group toggles the color mode against the resolved OS-aware mode, then links the account page.
 * The account link shows only while the discovery data lists account fields.
 * The destructive sign-out, a link to the logout page, sits alone in the last group.
 */
export function headerDropdownMenu(): HTMLElement {
  const t = useT();
  return menu(
    button(() => t('dashboard.header.openUserMenu'), {
      icon: 'dots-vertical',
      iconOnly: true,
      variant: 'outline',
    }),
    () => {
      const light = resolvedColorMode() === 'light';
      return [
        [
          {
            label: light ? 'dashboard.header.darkMode' : 'dashboard.header.lightMode',
            icon: light ? 'moon' : 'sun',
            onSelect: () => setColorMode(light ? 'dark' : 'light'),
          },
          (dashboardMeta()?.accountFields.length ?? 0) > 0 && {
            label: 'dashboard.header.myAccount',
            icon: 'user',
            href: '/account',
          },
        ],
        [{ label: 'dashboard.signOut', icon: 'logout', destructive: true, href: '/logout' }],
      ];
    },
  );
}

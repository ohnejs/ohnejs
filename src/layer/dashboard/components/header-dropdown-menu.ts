import {
  button,
  dashboardMeta,
  dropdown,
  dropdownItem,
  h,
  icon,
  resolvedColorMode,
  setColorMode,
  useT,
  when,
} from 'ohne/dashboard';
import { effect, ref } from 'ohne/utils';

/**
 * The header's kebab user menu.
 * The trigger turns primary while the dropdown is open.
 * One group toggles the color mode against the resolved OS-aware mode.
 * A rule separates it from the account link and the destructive sign-out, a link to the logout page.
 * The account link shows only while the discovery data lists account fields.
 */
export function headerDropdownMenu(): HTMLElement {
  const t = useT();
  const open = ref(false);
  const close = (): void => {
    open.value = false;
  };

  const trigger = button(icon('dots-vertical'), {
    variant: 'outline',
    onClick: () => {
      open.value = true;
    },
  });
  effect(() => {
    trigger.title = t('dashboard.header.openUserMenu');
    trigger.classList.toggle('ohne-button-primary', open.value);
    trigger.classList.toggle('ohne-button-outline', !open.value);
  });

  return h(
    'div',
    { class: 'ohne-flex' },
    trigger,
    when(
      () => open.value,
      () =>
        dropdown(
          [
            () => {
              const mode = resolvedColorMode();
              return dropdownItem(
                [
                  icon(mode === 'light' ? 'moon' : 'sun'),
                  h(
                    'span',
                    null,
                    t(
                      mode === 'light' ? 'dashboard.header.darkMode' : 'dashboard.header.lightMode',
                    ),
                  ),
                ],
                {
                  onClick: () => {
                    setColorMode(mode === 'light' ? 'dark' : 'light');
                    close();
                  },
                },
              );
            },
            h('hr'),
            when(
              () => (dashboardMeta()?.accountFields.length ?? 0) > 0,
              () =>
                dropdownItem(
                  [icon('user'), h('span', null, () => t('dashboard.header.myAccount'))],
                  {
                    href: '/account',
                    onClick: close,
                  },
                ),
            ),
            dropdownItem([icon('logout'), h('span', null, () => t('dashboard.signOut'))], {
              href: '/logout',
              destructive: true,
              onClick: close,
            }),
          ],
          { reference: trigger, onClose: close },
        ).root,
    ),
  );
}

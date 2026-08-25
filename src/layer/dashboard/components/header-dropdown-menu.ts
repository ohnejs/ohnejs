import {
  button,
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
 * The header's kebab user menu, ported from Pruvious v4's `HeaderDropdownMenu`.
 * The trigger turns primary while the dropdown is open.
 * One group toggles the color mode against the resolved OS-aware mode.
 * A rule separates it from the destructive sign-out, a link to the logout page as in the source.
 * P4's `My account` and `Clear page cache` items have no ohne counterpart and are omitted.
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
  trigger.title = t('dashboard.header.openUserMenu');
  effect(() => {
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

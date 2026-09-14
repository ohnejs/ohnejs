import {
  alert,
  button,
  type Child,
  field,
  h,
  icon,
  logout,
  popup,
  sessionUser,
  setUnauthorizedHandler,
  useRoute,
  useT,
  when,
} from 'ohnejs/dashboard';
import { effect, isNullish, ref, type Ref, untracked } from 'ohnejs/utils';

import { loginForm } from './login-form.ts';

/**
 * Whether the session-expired popup is open, shared app-wide.
 * The API client flips it `true` when a non-auth call answers `401`, through `setUnauthorizedHandler`.
 * A successful re-login and the Leave button flip it back.
 */
export const loginPopupOpen: Ref<boolean> = ref(false);

setUnauthorizedHandler(() => {
  loginPopupOpen.value = true;
});

/**
 * The session-expired re-login popup, mounted once by the shell.
 * It renders only while `loginPopupOpen` is set and outside the login page.
 * Neither Escape nor the overlay click dismisses it.
 * The exits are a successful sign-in, observed through `sessionUser`, and the Leave button, which signs out.
 */
export function loginPopup(): Child {
  return when(
    () => loginPopupOpen.value && useRoute()?.path !== '/login',
    () => {
      const t = useT();
      const before = untracked(() => sessionUser());
      effect(() => {
        const user = sessionUser();
        if (!isNullish(user) && user !== before) loginPopupOpen.value = false;
      });
      popup(
        loginForm({
          header: field(() =>
            alert(
              h('p', null, () => t('dashboard.session.expiredBody')),
              {
                title: t('dashboard.session.expired'),
                icon: icon('info-circle'),
              },
            ),
          ),
          footer: field(
            button(() => t('dashboard.session.leave'), {
              variant: 'outline',
              class: 'ohne-w-full',
              onClick: () => {
                loginPopupOpen.value = false;
                void logout();
              },
            }),
            { class: 'ohne-field-narrow' },
          ),
        }),
        { size: -1, width: '21rem' },
      );
      return null;
    },
  );
}

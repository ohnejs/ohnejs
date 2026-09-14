import { contentLocale } from 'app/components/content-language-switcher.ts';
import { sessionUser, useDashboardLanguage, watchOSClipboard } from 'ohnejs/dashboard';
import { effect, effectScope, isNullish } from 'ohnejs/utils';

// The seed lands once: a later store answer carrying a stale locale must not undo an in-session choice.
const seeding = effectScope();
seeding.run(() =>
  effect(() => {
    const user = sessionUser();
    if (isNullish(user)) return;
    contentLocale.value = user.contentLanguage ?? undefined;
    seeding.dispose();
  }),
);

effect(() => {
  document.documentElement.lang = useDashboardLanguage().value;
});

watchOSClipboard(() => sessionUser()?.smartClipboard === true);

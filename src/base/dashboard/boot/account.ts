import { contentLocale } from 'app/components/content-language-switcher.ts';
import { sessionUser, useDashboardLanguage, watchOSClipboard } from 'ohnejs/dashboard';
import { effect, isNullish } from 'ohnejs/utils';

// The seed lands once per user: a later store answer carrying a stale locale must not undo a choice.
let seededFor: string | undefined;
effect(() => {
  const user = sessionUser();
  if (isNullish(user) || user.UUID === seededFor) return;
  seededFor = user.UUID;
  contentLocale.value = user.contentLanguage ?? undefined;
});

effect(() => {
  document.documentElement.lang = useDashboardLanguage().value;
});

watchOSClipboard(() => sessionUser()?.smartClipboard === true);

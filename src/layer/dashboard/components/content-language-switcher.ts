import {
  attachTooltip,
  button,
  type Child,
  css,
  dashboardMeta,
  dropdown,
  dropdownItem,
  h,
  icon,
  sessionUser,
  toast,
  updateSessionUser,
  useDashboardLanguage,
  useRoute,
  useT,
  when,
} from 'ohnejs/dashboard';
import {
  capitalize,
  effect,
  formatLocaleCode,
  isNull,
  isUndefined,
  onCleanup,
  ref,
  type Ref,
  untracked,
} from 'ohnejs/utils';

/**
 * The content locale the dashboard edits records in, shared app-wide.
 * Distinct from the interface language: it addresses translatable field values.
 * `undefined` means the app's default locale; the switcher writes chosen codes here.
 * The user record holds the preference: the session seeds the ref, and the switcher persists each change.
 */
export const contentLocale: Ref<string | undefined> = ref<string | undefined>(undefined);

/**
 * The validated content locale, reactively: the chosen code while the discovery data lists it.
 * `undefined` while nothing valid is chosen, so reads and writes address the default locale.
 * A stale persisted code the app no longer configures reads as `undefined`, never as itself.
 */
export function activeContentLocale(): string | undefined {
  const chosen = contentLocale.value;
  if (isUndefined(chosen)) return undefined;
  return (dashboardMeta()?.locales.includes(chosen) ?? false) ? chosen : undefined;
}

css`
  .ohne-button .o-content-language-label,
  .ohne-button .o-content-language-icon {
    font-size: 1em;
  }
`;

const contexts: (() => boolean)[] = [];

/**
 * Declares a page family that edits translatable content.
 * The header shows the content-language switcher while `matches` reports `true`, read reactively.
 * Collection pages need no registration; they qualify through their collection.
 *
 * @example
 * ```ts
 * registerTranslatableContext(() => useRoute()?.path.startsWith('/media') === true)
 * ```
 */
export function registerTranslatableContext(matches: () => boolean): void {
  contexts.push(matches);
}

/**
 * The header's content-language dropdown.
 * It renders only while the discovery data lists more than one locale and the page is translatable.
 * The button shows the active locale's formatted code; picking another persists it and toasts.
 * The choice lands on the user record; an unreachable server toasts, and the choice holds for the session.
 */
export function contentLanguageSwitcher(): Child {
  return when(
    () => (dashboardMeta()?.locales.length ?? 0) > 1 && translatableContext(),
    () => switcher(),
  );
}

/**
 * Whether the current page edits translatable content, reactively.
 */
function translatableContext(): boolean {
  return collectionContext() || contexts.some((matches) => matches());
}

/**
 * Whether the route is a collection page whose collection declares translatable fields.
 */
function collectionContext(): boolean {
  const segment = useRoute()?.params.collection;
  if (isUndefined(segment)) return false;
  const meta = dashboardMeta();
  return meta?.collections.find((entry) => entry.segment === segment)?.translatable === true;
}

/**
 * The switcher proper: the outline trigger, primary while open, over the locale dropdown.
 */
function switcher(): HTMLElement {
  const t = useT();
  const open = ref(false);

  let preferred = untracked(() => sessionUser()?.contentLanguage ?? null);
  effect(() => {
    const locale = contentLocale.value ?? null;
    if (locale === preferred) return;
    preferred = locale;
    if (!isNull(locale)) {
      toast(t('dashboard.header.switchedContentLanguage', { language: formatLocaleCode(locale) }));
    }
    void updateSessionUser({ contentLanguage: locale }).then((outcome) => {
      if (outcome.kind === 'unreachable') toast(t('dashboard.unreachable'), { type: 'error' });
    });
  });

  const chevron = icon('chevron-down');
  chevron.classList.add('o-content-language-icon');
  const trigger = button(
    [
      h('span', { class: 'o-content-language-label' }, () =>
        formatLocaleCode(effectiveContentLocale()),
      ),
      chevron,
    ],
    {
      variant: 'outline',
      onClick: () => {
        open.value = true;
      },
    },
  );
  effect(() => {
    trigger.classList.toggle('ohne-button-primary', open.value);
    trigger.classList.toggle('ohne-button-outline', !open.value);
  });
  onCleanup(attachTooltip(trigger, () => t('dashboard.header.contentLanguage')));

  return h(
    'span',
    null,
    trigger,
    when(
      () => open.value,
      () =>
        dropdown(
          () =>
            (dashboardMeta()?.locales ?? []).map((locale) => {
              const selected = effectiveContentLocale() === locale;
              return dropdownItem(
                [selected ? icon('check') : null, h('span', null, localeName(locale))],
                {
                  indent: !selected,
                  onClick: () => {
                    contentLocale.value = locale;
                    open.value = false;
                  },
                },
              );
            }),
          {
            reference: trigger,
            restoreFocus: false,
            onClose: () => {
              open.value = false;
            },
          },
        ).root,
    ),
  );
}

/**
 * The locale in effect, reactively: the chosen one while the discovery data lists it, else the default.
 * Where `activeContentLocale` answers what a read or write should send, this answers what to display.
 */
export function effectiveContentLocale(): string {
  const meta = dashboardMeta();
  const chosen = contentLocale.value;
  if (!isUndefined(chosen) && (meta?.locales.includes(chosen) ?? false)) return chosen;
  return meta?.defaultLocale ?? '';
}

/**
 * The locale's display name in the dashboard's interface language, falling back to the code.
 * The name is capitalized, since some languages spell language names lowercase.
 * The discovery data carries only codes.
 */
export function localeName(code: string): string {
  try {
    return capitalize(
      new Intl.DisplayNames([useDashboardLanguage().value], { type: 'language' }).of(code) ?? code,
    );
  } catch {
    return code;
  }
}

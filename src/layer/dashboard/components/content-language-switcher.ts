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
  toast,
  useDashboardLanguage,
  useT,
  when,
} from 'ohne/dashboard';
import { effect, onCleanup, ref, type Ref } from 'ohne/utils';

const STORAGE_KEY = 'ohne:content-locale';

/**
 * The content locale the dashboard edits records in, shared app-wide.
 * Distinct from the interface language: it addresses translatable field values.
 * `undefined` means the app's default locale; the switcher writes chosen codes here.
 * The preference persists in `localStorage`.
 * The record editor and the single-field edit popup resolve field values through it.
 */
export const contentLocale: Ref<string | undefined> = ref<string | undefined>(
  localStorage.getItem(STORAGE_KEY) ?? undefined,
);

css`
  .ohne-button .o-content-language-label,
  .ohne-button .o-content-language-icon {
    font-size: 1em;
  }
`;

/**
 * The header's content-language dropdown, ported from Pruvious v4's `ContentLanguageSwitcher`.
 * It renders only while the discovery data lists more than one locale.
 * The button shows the active locale's formatted code; picking another persists it and toasts.
 * P4 gated visibility per page and persisted through the account.
 * ohne has neither surface, so the switcher always shows and persists locally.
 */
export function contentLanguageSwitcher(): Child {
  return when(
    () => (dashboardMeta()?.locales.length ?? 0) > 1,
    () => switcher(),
  );
}

/**
 * The switcher proper: the outline trigger, primary while open, over the locale dropdown.
 */
function switcher(): HTMLElement {
  const t = useT();
  const open = ref(false);

  let preferred = localStorage.getItem(STORAGE_KEY);
  effect(() => {
    const locale = contentLocale.value;
    if (locale !== undefined && locale !== preferred) {
      preferred = locale;
      localStorage.setItem(STORAGE_KEY, locale);
      toast(t('dashboard.header.switchedContentLanguage', { language: formatLocaleCode(locale) }));
    }
  });

  const chevron = icon('chevron-down');
  chevron.classList.add('o-content-language-icon');
  const trigger = button(
    [h('span', { class: 'o-content-language-label' }, () => formatLocaleCode(current())), chevron],
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
              const selected = current() === locale;
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
 * The locale in effect: the chosen one while the discovery data lists it, else the default.
 */
function current(): string {
  const meta = dashboardMeta();
  const chosen = contentLocale.value;
  if (chosen !== undefined && (meta?.locales.includes(chosen) ?? false)) return chosen;
  return meta?.defaultLocale ?? '';
}

/**
 * Formats a locale code for the trigger, as P4's `formatLanguageCode` did.
 */
function formatLocaleCode(code: string): string {
  const [language = '', region] = code.split('-');
  return region === undefined
    ? language.toUpperCase()
    : `${language.toUpperCase()} (${region.toUpperCase()})`;
}

/**
 * The locale's display name in the dashboard's interface language, falling back to the code.
 * P4 showed configured language names; ohne's discovery data carries only codes.
 */
function localeName(code: string): string {
  try {
    return (
      new Intl.DisplayNames([useDashboardLanguage().value], { type: 'language' }).of(code) ?? code
    );
  } catch {
    return code;
  }
}

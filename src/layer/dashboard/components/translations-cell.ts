import { attachTooltip, css, dashboardMeta, dimMark, h, useT } from 'ohne/dashboard';
import { formatLocaleCode, isArray, isUndefined, onCleanup } from 'ohne/utils';

import { effectiveContentLocale, localeName } from './content-language-switcher.ts';

/**
 * Options for `translationsCell`.
 */
export interface TranslationsCellOptions {
  /**
   * Whether the viewer may write the collection, so a chip edits or creates its locale's translation.
   * Without it a translated locale views and a missing one is a plain marker.
   */
  canUpdate: boolean;

  /**
   * The record URL a locale's chip links to, given the locale code.
   * Omitted renders every chip as a plain marker, for a surface that never navigates.
   */
  href?: (code: string) => string;
}

css`
  .o-translations-cell {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    align-items: center;
  }

  .o-translations-chip {
    display: inline-flex;
    align-items: center;
    height: 1.5rem;
    padding: 0 0.5rem;
    border-width: 1px;
    border-color: transparent;
    border-radius: calc(var(--ohne-radius) - 0.125rem);
    background-color: hsl(var(--ohne-secondary));
    color: hsl(var(--ohne-muted-foreground));
    font-size: calc(1em - 0.1875rem);
    font-weight: 600;
    line-height: 1;
    letter-spacing: 0.04em;
    white-space: nowrap;
    text-decoration: none;
    user-select: none;
    transition: var(--ohne-transition);
    transition-property: background-color, border-color, color;
  }

  .o-translations-chip-missing {
    background-color: transparent;
    border-color: hsl(var(--ohne-border));
    color: hsl(var(--ohne-muted-foreground) / 0.64);
  }

  .o-translations-chip-active {
    color: hsl(var(--ohne-foreground));
  }

  a.o-translations-chip:hover {
    background-color: hsl(var(--ohne-accent));
    border-color: hsl(var(--ohne-accent));
    color: hsl(var(--ohne-accent-foreground));
  }

  a.o-translations-chip:focus-visible {
    box-shadow:
      0 0 0 0.125rem hsl(var(--ohne-background)),
      0 0 0 0.25rem hsl(var(--ohne-ring));
    outline: 0.125rem solid transparent;
  }
`;

/**
 * The `_translations` cell: one chip per configured locale, in configured order.
 *
 * A translated locale fills its chip; a missing one stays hollow and faint.
 * The active content locale reads in full foreground, so the column forms one stripe down the table.
 * With `href`, a chip links to the record at its locale: a translated one edits, a missing one creates.
 * A viewer without `canUpdate` reaches a translated locale to view it; a missing one stays a marker.
 * Each chip's tooltip names the language and the action it offers.
 * A row whose value is not a list renders a dash.
 */
export function translationsCell(
  row: Record<string, unknown>,
  options: TranslationsCellOptions,
): HTMLElement {
  const t = useT();
  const held = row._translations;
  const tooltip = (code: string, translated: boolean, linked: boolean): string => {
    const locale = localeName(code);
    if (!translated) {
      return t(
        linked ? 'dashboard.translations.newLocale' : 'dashboard.translations.missingLocale',
        { locale },
      );
    }
    if (!linked) return locale;
    return t(
      options.canUpdate ? 'dashboard.translations.editLocale' : 'dashboard.translations.viewLocale',
      { locale },
    );
  };
  return h('div', { class: 'o-translations-cell' }, () => {
    if (!isArray<string[]>(held)) return dimMark('-');
    const active = effectiveContentLocale();
    return (dashboardMeta()?.locales ?? []).map((code) => {
      const translated = held.includes(code);
      const linked = !isUndefined(options.href) && (translated || options.canUpdate);
      const attributes = {
        class:
          'o-translations-chip' +
          (translated ? '' : ' o-translations-chip-missing') +
          (code === active ? ' o-translations-chip-active' : ''),
        'aria-current': code === active ? 'true' : null,
      };
      const chip = linked
        ? h(
            'a',
            { ...attributes, class: `${attributes.class} ohne-raw`, href: options.href?.(code) },
            formatLocaleCode(code),
          )
        : h('span', attributes, formatLocaleCode(code));
      onCleanup(attachTooltip(chip, () => tooltip(code, translated, linked)));
      return chip;
    });
  });
}

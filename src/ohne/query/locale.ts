import type { ResolvedLocales } from '../collections/resolve-locales.ts';

import { canonicalizeLanguage, isNull } from '../../utils/index.ts';
import { resolveLocales } from '../collections/resolve-locales.ts';
import { ohneError } from '../error/ohne-error.ts';
import { useConfig } from '../layers/use-config.ts';

/**
 * Returns the app's content locales, resolved from config.
 * The query layer is the write-layer enforcer of the set the schema engine never reads.
 * Read live like `resolveGuards` reads its config tier, so tests vary the config freely.
 */
export function queryLocales(): ResolvedLocales {
  return resolveLocales(useConfig().collections);
}

/**
 * Resolves the locale a query reads and writes: the explicit `.locale()` choice, else the default.
 * Every locale-scoped table access binds the value this returns.
 */
export function effectiveLocale(explicit: string | null): string {
  return explicit ?? queryLocales().defaultLocale;
}

/**
 * Validates a `.locale()` argument against the configured set and returns the canonical tag.
 * A malformed tag or one outside `collections.locales` throws.
 */
export function checkQueryLocale(code: string): string {
  const canonical = canonicalizeLanguage(code);
  const { locales } = queryLocales();
  if (isNull(canonical) || !locales.includes(canonical)) {
    throw ohneError({
      title: `Unknown locale \`${code}\``,
      body: [
        `\`collections.locales\` holds ${locales.map((locale) => `\`${locale}\``).join(', ')}.`,
        'Pass one of them, or add the locale to the set.',
      ],
    });
  }
  return canonical;
}

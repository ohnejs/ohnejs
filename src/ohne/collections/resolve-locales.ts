import type { Config } from '../layers/config.ts';

import { canonicalizeLanguage, isNull, isUndefined } from '../../utils/index.ts';
import { ohneError } from '../error/ohne-error.ts';

/**
 * The content-locale settings, canonicalized and validated.
 */
export interface ResolvedLocales {
  /**
   * The content locales records may hold, each a canonical BCP-47 tag.
   * The write layer enforces the set; sync never reads it.
   */
  locales: string[];

  /**
   * The locale existing values land on when a field turns translatable.
   * Always a member of `locales`.
   * The one value the schema engine consumes.
   */
  defaultLocale: string;
}

/**
 * Resolves the `collections` config group into validated content locales.
 *
 * Every tag canonicalizes through `canonicalizeLanguage`; an invalid one throws.
 * Two entries canonicalizing to the same tag throw too.
 * `defaultLocale` must be a member of `locales` - it never guesses the set's first entry.
 * So `locales: ['de', 'fr']` without an explicit `defaultLocale` errors loudly.
 *
 * @example
 * ```ts
 * resolveLocales({ locales: ['en', 'de-at'], defaultLocale: 'en' })
 * // -> { locales: ['en', 'de-AT'], defaultLocale: 'en' }
 *
 * resolveLocales(undefined)
 * // -> { locales: ['en'], defaultLocale: 'en' }
 * ```
 */
export function resolveLocales(collections: Config['collections']): ResolvedLocales {
  const locales: string[] = [];
  const sources = new Map<string, string>();
  for (const tag of collections?.locales ?? ['en']) {
    const canonical = canonicalizeLanguage(tag);
    if (isNull(canonical)) {
      throw ohneError({
        title: `Invalid content locale \`${tag}\``,
        body: ['Set `collections.locales` entries to valid BCP-47 tags, like `en` or `de-AT`.'],
      });
    }
    const seen = sources.get(canonical);
    if (!isUndefined(seen)) {
      throw ohneError({
        title: `Duplicate content locale \`${canonical}\``,
        body: [`\`${seen}\` and \`${tag}\` both canonicalize to \`${canonical}\`.`, 'Drop one.'],
      });
    }
    sources.set(canonical, tag);
    locales.push(canonical);
  }
  if (locales.length === 0) {
    throw ohneError({
      title: 'Content locales cannot be empty',
      body: [
        '`collections.locales` holds no entries, so no record could hold content.',
        'List at least one locale, or drop the field to keep the default `en`.',
      ],
    });
  }
  const configured = collections?.defaultLocale ?? 'en';
  const defaultLocale = canonicalizeLanguage(configured);
  if (isNull(defaultLocale)) {
    throw ohneError({
      title: `Invalid default locale \`${configured}\``,
      body: ['Set `collections.defaultLocale` to a valid BCP-47 tag, like `en` or `de-AT`.'],
    });
  }
  if (!locales.includes(defaultLocale)) {
    throw ohneError({
      title: `Default locale \`${defaultLocale}\` is not a content locale`,
      body: [
        `\`collections.locales\` holds ${locales.map((locale) => `\`${locale}\``).join(', ')}, and the default must be one of them.`,
        `Add \`${defaultLocale}\` to the set, or point \`defaultLocale\` at one of its entries.`,
      ],
    });
  }
  return { locales, defaultLocale };
}

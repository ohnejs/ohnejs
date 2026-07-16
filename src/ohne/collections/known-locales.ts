/**
 * The app's content locales, augmented by codegen.
 *
 * Codegen writes `interface KnownLocales extends GeneratedLocales {}` into the app's `.ohne` files.
 * The generated table carries one `true`-valued key per configured locale, like `KnownLanguages`.
 * The framework program never augments it, so here it stays empty.
 */
export interface KnownLocales {}

/**
 * One content locale, as `.locale()` accepts it.
 * Narrows to the configured locale set once codegen has run; falls back to `string` until then.
 */
export type LocaleCode = [keyof KnownLocales] extends [never]
  ? string
  : keyof KnownLocales & string;

/**
 * Declares this layer's field types in `LayerFields`, for every program that checks the layer's source.
 *
 * The layer's collections import this file, so a package that imports them typechecks without codegen.
 * An app's codegen declares the same names in `KnownFields`, which wins, so a closer override keeps its type.
 * The scanner skips `_`-prefixed files, so it contributes types alone.
 */
declare module 'ohnejs' {
  interface LayerFields {
    /**
     * A date or time format pattern, like `YYYY-MM-DD`.
     */
    datePattern: typeof import('./date-pattern.ts').default;

    /**
     * A dashboard language, stored as its canonical BCP-47 tag.
     */
    language: typeof import('./language.ts').default;

    /**
     * A content locale, one of the configured `collections.locales`.
     */
    locale: typeof import('./locale.ts').default;

    /**
     * A plaintext password stored as its scrypt hash.
     */
    password: typeof import('./password.ts').default;

    /**
     * A list of role names, stored as a JSON list.
     */
    roles: typeof import('./roles.ts').default;

    /**
     * An IANA time zone name, like `Europe/Berlin`.
     */
    timezone: typeof import('./timezone.ts').default;
  }
}

export {};

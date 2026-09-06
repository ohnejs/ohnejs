/**
 * Registers this layer's field types in `KnownFields` for the framework repo's own typecheck.
 *
 * An app gets this augmentation from codegen, which scans the layer's fields into `.ohne`.
 * The repo cannot consume its own `.ohne`: its tests register collections outside any generated schema.
 * The generated augmentations would narrow those names away, so this file is the one hand-kept mirror.
 * The scanner skips `_`-prefixed files, so it contributes types alone.
 */
declare module 'ohne' {
  interface KnownFields {
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

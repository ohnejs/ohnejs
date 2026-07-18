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
     * A plaintext password stored as its scrypt hash.
     */
    password: typeof import('./password.ts').default;
  }
}

export {};

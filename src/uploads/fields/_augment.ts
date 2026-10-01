/**
 * Registers this layer's field types in `KnownFields` for the framework repo's own typecheck.
 *
 * An app gets this augmentation from codegen, which scans the layer's fields into `.ohne`.
 * The repo cannot consume its own `.ohne`: its tests register collections outside any generated schema.
 * The generated augmentations would narrow those names away, so this file is the layer's hand-kept mirror.
 * The scanner skips `_`-prefixed files, so it contributes types alone.
 */
declare module 'ohnejs' {
  interface KnownFields {
    /**
     * A reference to one uploaded image.
     */
    image: typeof import('./image.ts').default;

    /**
     * A reference to one uploaded file.
     */
    file: typeof import('./file.ts').default;

    /**
     * An ordered list of references to uploaded images.
     */
    images: typeof import('./images.ts').default;

    /**
     * An ordered list of references to uploaded files.
     */
    files: typeof import('./files.ts').default;

    /**
     * A file name, stored canonical and searched by the name as typed.
     */
    fileName: typeof import('./file-name.ts').default;

    /**
     * A directory path, stored canonical and searched by the path as typed.
     */
    directoryName: typeof import('./directory-name.ts').default;
  }
}

export {};

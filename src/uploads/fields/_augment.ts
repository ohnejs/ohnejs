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

/**
 * How many leading bytes of an upload its type is sniffed and its image measured by.
 * `uploads.chunkSize` never goes below it, so a resumable upload's first chunk holds them all.
 */
export const PEEK_SIZE = 64 * 1024;

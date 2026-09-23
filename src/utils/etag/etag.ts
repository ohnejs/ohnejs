import { digest } from '../crypto/digest.ts';
import { isString } from '../is/is-string.ts';

/**
 * File metadata an ETag can be derived from, a structural subset of `node:fs` `Stats`.
 */
export interface ETagStats {
  /**
   * The entity size in bytes.
   */
  size: number;

  /**
   * The last modification time.
   */
  mtime: Date;
}

/**
 * Options for `etag`.
 */
export interface ETagOptions {
  /**
   * Emit a weak tag (`W/"..."`) instead of a strong one.
   * Content defaults to strong and stats to weak, since stats cannot prove byte-equality.
   */
  weak?: boolean;
}

/**
 * Formats the quoted tag for bytes: the hex byte length, then the SHA-1 in base64 without padding.
 */
function contentTag(entity: string | Uint8Array): string {
  const size = isString(entity) ? Buffer.byteLength(entity) : entity.length;
  const hash = digest('sha1', entity).toBase64().slice(0, 27);
  return `"${size.toString(16)}-${hash}"`;
}

/**
 * Formats the quoted tag for stats: the hex size, then the hex mtime in milliseconds.
 */
function statTag(stats: ETagStats): string {
  return `"${stats.size.toString(16)}-${stats.mtime.getTime().toString(16)}"`;
}

/**
 * Computes an entity tag for a response body or a file's stats, for caching and conditional requests.
 * Content yields a strong tag: a hex length plus a base64 SHA-1 of the bytes.
 * Stats yield a weak tag (`W/"size-mtime"`), since equal size and mtime do not prove identical bytes.
 *
 * Pass `weak` to override either default.
 * Set the result as the response `ETag` header, then answer a matching `If-None-Match` with `304`.
 *
 * @example
 * ```ts
 * etag('hello')                            // -> '"5-qvTGHdzF6KLavt4PO0gs2a6pQ00"'
 * etag('hello', { weak: true })            // -> 'W/"5-qvTGHdzF6KLavt4PO0gs2a6pQ00"'
 * etag({ size: 1024, mtime: new Date(0) }) // -> 'W/"400-0"'
 * ```
 */
export function etag(entity: string | Uint8Array | ETagStats, options: ETagOptions = {}): string {
  if (isString(entity) || entity instanceof Uint8Array) {
    const tag = contentTag(entity);
    return options.weak === true ? `W/${tag}` : tag;
  }

  const tag = statTag(entity);
  return options.weak === false ? tag : `W/${tag}`;
}

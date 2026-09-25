import { parseMediaType } from '../media-type/parse-media-type.ts';
import { percentDecode } from '../uri/percent-decode.ts';

/**
 * A `Content-Disposition` header parsed into its disposition type and file name, per RFC 6266.
 */
export interface ContentDisposition {
  /**
   * The lowercased disposition type, `'attachment'` or `'inline'` in practice; `''` when the header is empty.
   */
  type: string;

  /**
   * The file name exactly as the sender wrote it, decoded but never sanitized.
   * Absent when the header names no file, or only an empty one.
   */
  filename?: string;
}

const EXT_VALUE = /^([^']+)'[^']*'(\p{ASCII}*)$/u;

/**
 * Parses a `Content-Disposition` header value into its type and file name, per RFC 6266.
 * Names are case-insensitive, and the first of a duplicated parameter wins.
 * Quoted strings are unwrapped, honoring backslash escapes.
 *
 * `filename*` wins over `filename`: an RFC 8187 `charset'language'value`, percent-decoded in its charset.
 * The language tag is ignored.
 * A malformed `filename*` falls back to `filename`.
 * Malformed means an unknown charset, raw non-ASCII, a broken escape, or bytes invalid in the charset.
 *
 * The name is returned raw, so `../../etc/passwd` comes back as is.
 * Sanitize it before it names anything, as `slugifyFileName` does.
 * Untrusted input never throws.
 *
 * @example
 * ```ts
 * parseContentDisposition('attachment; filename="thrall.png"')
 * // -> { type: 'attachment', filename: 'thrall.png' }
 *
 * parseContentDisposition(`attachment; filename="EURO rates.pdf"; filename*=UTF-8''%E2%82%AC%20rates.pdf`)
 * // -> { type: 'attachment', filename: '€ rates.pdf' }
 *
 * parseContentDisposition('inline')
 * // -> { type: 'inline' }
 * ```
 */
export function parseContentDisposition(header: string): ContentDisposition {
  const { type, parameters } = parseMediaType(header);
  const filename = decodeExtValue(parameters['filename*']) || parameters.filename;
  return filename ? { type, filename } : { type };
}

/**
 * Decodes an RFC 8187 `charset'language'value`, or returns `undefined` when it is absent or malformed.
 */
function decodeExtValue(value: string | undefined): string | undefined {
  const match = EXT_VALUE.exec(value ?? '');
  return match ? percentDecode(match[2], match[1]) : undefined;
}

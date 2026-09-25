const ESCAPES = /(?:%[\dA-Fa-f]{2})+/g;
const STRAY_PERCENT = /%(?![\dA-Fa-f]{2})/;

/**
 * The common labels of UTF-8, which the built-in `decodeURIComponent` decodes strictly and fast.
 */
const UTF8 = new Set(['utf-8', 'utf8']);

/**
 * Decodes the percent-escapes in `value` as bytes in `charset`, a WHATWG encoding label.
 * Characters outside an escape stay as they are, as with `decodeURIComponent`.
 *
 * Returns `undefined` instead of throwing when the value does not decode.
 * That is a `%` without two hex digits after it, bytes invalid in `charset`, or an unknown `charset`.
 *
 * @example
 * ```ts
 * percentDecode('a%20b')             // -> 'a b'
 * percentDecode('%E2%82%AC')         // -> '€'
 * percentDecode('%E4', 'iso-8859-1') // -> 'ä'
 * percentDecode('%E4')               // -> undefined
 * percentDecode('%zz')               // -> undefined
 * ```
 */
export function percentDecode(value: string, charset = 'utf-8'): string | undefined {
  if (STRAY_PERCENT.test(value)) return undefined;
  try {
    if (UTF8.has(charset.toLowerCase())) {
      return value.includes('%') ? decodeURIComponent(value) : value;
    }
    // Keeps an escaped U+FEFF, which the decoder would otherwise strip as a byte order mark.
    const decoder = new TextDecoder(charset, { fatal: true, ignoreBOM: true });
    return value.replace(ESCAPES, (run) => decoder.decode(escapedBytes(run)));
  } catch {
    return undefined;
  }
}

/**
 * Reads a run of `%XX` escapes as the bytes they stand for.
 */
function escapedBytes(run: string): Uint8Array {
  return Uint8Array.from(run.slice(1).split('%'), (hex) => Number.parseInt(hex, 16));
}

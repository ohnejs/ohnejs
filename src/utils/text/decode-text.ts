const decoder = new TextDecoder('utf-8', { fatal: true });
const verbatim = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/**
 * Decodes UTF-8 `bytes` to a string, throwing on malformed input.
 * Only UTF-8 is decoded; a declared charset is never honored.
 * An invalid sequence throws rather than being replaced with `U+FFFD`.
 * A leading byte order mark is dropped unless `keepBOM` is set, for formats where it is part of the text.
 *
 * At a request boundary, map the thrown `TypeError` to a `400`.
 *
 * @example
 * ```ts
 * decodeText(new Uint8Array([104, 105]))                            // -> 'hi'
 * decodeText(new Uint8Array(0))                                     // -> ''
 * decodeText(new Uint8Array([255]))                                 // throws TypeError
 * decodeText(new Uint8Array([239, 187, 191, 97]), { keepBOM: true }) // -> '\uFEFFa'
 * ```
 */
export function decodeText(bytes: Uint8Array, options: { keepBOM?: boolean } = {}): string {
  return (options.keepBOM ? verbatim : decoder).decode(bytes);
}

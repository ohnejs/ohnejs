const decoder = new TextDecoder('utf-8', { fatal: true });

/**
 * Decodes UTF-8 `bytes` to a string, throwing on malformed input.
 * Only UTF-8 is decoded; a declared charset is never honored.
 * An invalid sequence throws rather than being replaced with `U+FFFD`.
 *
 * At a request boundary, map the thrown `TypeError` to a `400`.
 *
 * @example
 * ```ts
 * decodeText(new Uint8Array([104, 105])) // -> 'hi'
 * decodeText(new Uint8Array(0))          // -> ''
 * decodeText(new Uint8Array([255]))      // throws TypeError
 * ```
 */
export function decodeText(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

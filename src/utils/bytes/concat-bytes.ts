/**
 * Joins `parts` into one byte array.
 *
 * @example
 * ```ts
 * concatBytes(new Uint8Array([1]), new Uint8Array([2, 3])) // -> Uint8Array [1, 2, 3]
 * ```
 */
export function concatBytes(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

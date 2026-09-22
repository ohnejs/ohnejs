/**
 * Generates an RFC 9562 UUIDv7.
 * The first 48 bits hold the Unix-millisecond timestamp, big-endian; the remaining 74 are random.
 * Ids sort by the millisecond they were minted in; within one millisecond they order at random.
 * The timestamp prefix keeps inserts local in a text primary-key B-tree.
 *
 * Isomorphic: uses `globalThis.crypto`, available in Node and browsers alike.
 *
 * @example
 * ```ts
 * uuidv7() // -> '019f3c1a-8b2d-7f4e-9a6b-1c2d3e4f5a6b' (timestamp prefix, random tail)
 * ```
 */
export function uuidv7(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const ms = Date.now();

  // Uint8Array assignment truncates and wraps, slicing the 48-bit timestamp into big-endian bytes.
  for (let i = 0; i < 6; i++) bytes[i] = ms / 2 ** (40 - 8 * i);
  bytes[6] = 0x70 | (bytes[6] & 0x0f);
  bytes[8] = 0x80 | (bytes[8] & 0x3f);

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

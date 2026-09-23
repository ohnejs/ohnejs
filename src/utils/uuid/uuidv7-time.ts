/**
 * Reads the Unix-millisecond timestamp a UUIDv7 was minted at, from its first 48 bits.
 * Anything but a UUIDv7 reads as `NaN` or as a meaningless time.
 *
 * @example
 * ```ts
 * uuidv7Time('019f3c1a-8b2d-7f4e-9a6b-1c2d3e4f5a6b') // -> 1783419800365
 * uuidv7Time(uuidv7())                               // -> Date.now() at minting
 * ```
 */
export function uuidv7Time(uuid: string): number {
  return Number.parseInt(uuid.slice(0, 8) + uuid.slice(9, 13), 16);
}

/**
 * Multiplies two elements of GF(256) under the QR field polynomial `0x11d`.
 *
 * @example
 * ```ts
 * gfMultiply(2, 0x80) // -> 0x1d
 * ```
 */
export function gfMultiply(x: number, y: number): number {
  let product = 0;
  for (let bit = 7; bit >= 0; bit -= 1) {
    product = (product << 1) ^ ((product >>> 7) * 0x11d);
    product ^= ((y >>> bit) & 1) * x;
  }
  return product;
}

/**
 * The `degree` Reed-Solomon error correction codewords QR appends to the data codewords `data`.
 *
 * @example
 * ```ts
 * reedSolomon(
 *   [0x10, 0x20, 0x0c, 0x56, 0x61, 0x80, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11],
 *   10,
 * )
 * // -> [0xa5, 0x24, 0xd4, 0xc1, 0xed, 0x36, 0xc7, 0x87, 0x2c, 0x55]
 * ```
 */
export function reedSolomon(data: readonly number[], degree: number): number[] {
  const generator = Array.from({ length: degree }, () => 0);
  generator[degree - 1] = 1;
  let root = 1;
  for (let step = 0; step < degree; step += 1) {
    for (let index = 0; index < degree; index += 1) {
      generator[index] = gfMultiply(generator[index]!, root) ^ (generator[index + 1] ?? 0);
    }
    root = gfMultiply(root, 2);
  }
  const remainder = Array.from({ length: degree }, () => 0);
  for (const codeword of data) {
    const factor = codeword ^ remainder.shift()!;
    remainder.push(0);
    for (let index = 0; index < degree; index += 1) {
      remainder[index]! ^= gfMultiply(generator[index]!, factor);
    }
  }
  return remainder;
}

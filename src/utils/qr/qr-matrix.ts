import { reedSolomon } from './_reed-solomon.ts';

interface Grid {
  size: number;
  dark: boolean[][];
  fixed: boolean[][];
}

const BLOCKS: readonly (readonly [total: number, ecc: number, count: number])[] = [
  [26, 10, 1],
  [44, 16, 1],
  [70, 26, 1],
  [100, 18, 2],
  [134, 24, 2],
  [172, 16, 4],
  [196, 18, 4],
  [242, 22, 4],
  [292, 22, 5],
  [346, 26, 5],
];

const ALIGNMENT: readonly (readonly number[])[] = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
];

const MASKS: readonly ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

const FINDER_LIKE = [
  [true, false, true, true, true, false, true, false, false, false, false],
  [false, false, false, false, true, false, true, true, true, false, true],
];

/**
 * The modules of a QR code for `text`, row by row, `true` for a dark module.
 * The text is UTF-8 in byte mode at error correction level M, in the smallest version from 1 to 10.
 * Of the eight masks, the one with the lowest penalty score wins.
 * Draw it with a light quiet zone of 4 modules on every side.
 *
 * @example
 * ```ts
 * const matrix = qrMatrix('otpauth://totp/ohne:ada?secret=JBSWY3DPEHPK3PXP')
 *
 * matrix.length // -> 33
 * matrix[0][0]  // -> true
 * matrix[7][7]  // -> false
 * ```
 */
export function qrMatrix(text: string): boolean[][] {
  const bytes = new TextEncoder().encode(text);
  const bits = (index: number): number => 4 + (index < 9 ? 8 : 16) + bytes.length * 8;
  const version =
    BLOCKS.findIndex(([total, ecc, count], index) => bits(index) <= (total - ecc * count) * 8) + 1;
  if (version === 0) throw new Error(`QR text of ${bytes.length} bytes exceeds the 213 byte limit`);
  const grid = functionPatterns(version);
  placeData(grid, codewords(bytes, version));
  let best: boolean[][] = [];
  let bestScore = Infinity;
  for (let mask = 0; mask < MASKS.length; mask += 1) {
    const candidate = masked(grid, mask);
    const score = penalty(candidate);
    if (score < bestScore) [best, bestScore] = [candidate, score];
  }
  return best;
}

function functionPatterns(version: number): Grid {
  const size = version * 4 + 17;
  const grid: Grid = {
    size,
    dark: Array.from({ length: size }, () => Array.from({ length: size }, () => false)),
    fixed: Array.from({ length: size }, () => Array.from({ length: size }, () => false)),
  };
  for (let index = 0; index < size; index += 1) {
    set(grid, 6, index, index % 2 === 0);
    set(grid, index, 6, index % 2 === 0);
  }
  for (const [x, y] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ] as const) {
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const ring = Math.max(Math.abs(dx), Math.abs(dy));
        if (x + dx >= 0 && x + dx < size && y + dy >= 0 && y + dy < size) {
          set(grid, x + dx, y + dy, ring !== 2 && ring !== 4);
        }
      }
    }
  }
  const centers = ALIGNMENT[version - 1]!;
  const last = centers.length - 1;
  for (const [column, x] of centers.entries()) {
    for (const [row, y] of centers.entries()) {
      const underFinder = column * row === 0 && (column + row === 0 || column + row === last);
      if (underFinder) continue;
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1)
          set(grid, x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }
  drawFormat(grid, 0);
  set(grid, 8, size - 8, true);
  if (version >= 7) {
    let remainder = version;
    for (let step = 0; step < 12; step += 1)
      remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
    const bits = (version << 12) | remainder;
    for (let index = 0; index < 18; index += 1) {
      const bit = ((bits >>> index) & 1) === 1;
      set(grid, size - 11 + (index % 3), Math.floor(index / 3), bit);
      set(grid, Math.floor(index / 3), size - 11 + (index % 3), bit);
    }
  }
  return grid;
}

function drawFormat(grid: Grid, mask: number): void {
  let remainder = mask;
  for (let step = 0; step < 10; step += 1)
    remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  const bits = ((mask << 10) | remainder) ^ 0x5412;
  const bit = (index: number): boolean => ((bits >>> index) & 1) === 1;
  const { size } = grid;
  for (let index = 0; index < 6; index += 1) set(grid, 8, index, bit(index));
  set(grid, 8, 7, bit(6));
  set(grid, 8, 8, bit(7));
  set(grid, 7, 8, bit(8));
  for (let index = 9; index < 15; index += 1) set(grid, 14 - index, 8, bit(index));
  for (let index = 0; index < 8; index += 1) set(grid, size - 1 - index, 8, bit(index));
  for (let index = 8; index < 15; index += 1) set(grid, 8, size - 15 + index, bit(index));
}

function set(grid: Grid, x: number, y: number, dark: boolean): void {
  grid.dark[y]![x] = dark;
  grid.fixed[y]![x] = true;
}

function codewords(bytes: Uint8Array, version: number): number[] {
  const [total, ecc, count] = BLOCKS[version - 1]!;
  const capacity = total - ecc * count;
  const bits: number[] = [];
  const push = (value: number, length: number): void => {
    for (let bit = length - 1; bit >= 0; bit -= 1) bits.push((value >>> bit) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, version < 10 ? 8 : 16);
  for (const byte of bytes) push(byte, 8);
  push(0, Math.min(4, capacity * 8 - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  const data: number[] = [];
  for (let index = 0; index < bits.length; index += 8) {
    data.push(bits.slice(index, index + 8).reduce((byte, bit) => (byte << 1) | bit, 0));
  }
  for (let pad = 0xec; data.length < capacity; pad ^= 0xec ^ 0x11) data.push(pad);
  const short = count - (total % count);
  const shortLength = Math.floor(total / count) - ecc;
  const blocks: number[][] = [];
  const corrections: number[][] = [];
  for (let index = 0, offset = 0; index < count; index += 1) {
    const block = data.slice(offset, (offset += shortLength + (index < short ? 0 : 1)));
    blocks.push(block);
    corrections.push(reedSolomon(block, ecc));
  }
  const result: number[] = [];
  for (let index = 0; index <= shortLength; index += 1) {
    for (const block of blocks) if (index < block.length) result.push(block[index]!);
  }
  for (let index = 0; index < ecc; index += 1) {
    for (const correction of corrections) result.push(correction[index]!);
  }
  return result;
}

function placeData(grid: Grid, data: readonly number[]): void {
  const { size } = grid;
  let index = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let step = 0; step < size; step += 1) {
      const y = upward ? size - 1 - step : step;
      for (const x of [right, right - 1]) {
        if (grid.fixed[y]![x] || index >= data.length * 8) continue;
        grid.dark[y]![x] = ((data[index >>> 3]! >>> (7 - (index & 7))) & 1) === 1;
        index += 1;
      }
    }
  }
}

function masked(grid: Grid, mask: number): boolean[][] {
  const result: Grid = {
    size: grid.size,
    dark: grid.dark.map((row, y) =>
      row.map((dark, x) => dark !== (!grid.fixed[y]![x] && MASKS[mask]!(x, y))),
    ),
    fixed: grid.fixed,
  };
  drawFormat(result, mask);
  return result.dark;
}

function penalty(dark: readonly (readonly boolean[])[]): number {
  const size = dark.length;
  const columns = dark.map((_, x) => dark.map((row) => row[x]!));
  let score = 0;
  for (const line of [...dark, ...columns]) {
    for (let start = 0, end = 1; end <= size; end += 1) {
      if (end < size && line[end] === line[start]) continue;
      if (end - start >= 5) score += end - start - 2;
      start = end;
    }
    const padded = [false, false, false, false, ...line, false, false, false, false];
    for (let start = 0; start + 11 <= padded.length; start += 1) {
      for (const pattern of FINDER_LIKE) {
        if (pattern.every((module, offset) => padded[start + offset] === module)) score += 40;
      }
    }
  }
  for (let y = 0; y < size - 1; y += 1) {
    for (let x = 0; x < size - 1; x += 1) {
      const module = dark[y]![x];
      if (
        dark[y]![x + 1] === module &&
        dark[y + 1]![x] === module &&
        dark[y + 1]![x + 1] === module
      )
        score += 3;
    }
  }
  const darkCount = dark.flat().filter(Boolean).length;
  return score + (Math.ceil(Math.abs(darkCount * 20 - size * size * 10) / (size * size)) - 1) * 10;
}

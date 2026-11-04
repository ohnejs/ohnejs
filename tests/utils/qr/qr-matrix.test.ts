import { deepStrictEqual, strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { qrMatrix } from '../../../src/utils/index.ts';
import { reedSolomon } from '../../../src/utils/qr/_reed-solomon.ts';

const BLOCKS = [
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
] as const;

const ALIGNMENT = [
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

const FORMAT_M = [
  0b101010000010010, 0b101000100100101, 0b101111001111100, 0b101101101001011, 0b100010111111001,
  0b100000011001110, 0b100111110010111, 0b100101010100000,
];

const VERSION_INFO = {
  7: 0b000111110010010100,
  8: 0b001000010110111100,
  9: 0b001001101010011001,
  10: 0b001010010011010011,
};

const MASKS = [
  (x: number, y: number) => (x + y) % 2 === 0,
  (_: number, y: number) => y % 2 === 0,
  (x: number) => x % 3 === 0,
  (x: number, y: number) => (x + y) % 3 === 0,
  (x: number, y: number) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x: number, y: number) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x: number, y: number) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x: number, y: number) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

const OHNE = [
  '#######..##...#######',
  '#.....#..#.#..#.....#',
  '#.###.#.####..#.###.#',
  '#.###.#.##..#.#.###.#',
  '#.###.#.#.###.#.###.#',
  '#.....#.#...#.#.....#',
  '#######.#.#.#.#######',
  '........#.###........',
  '#.#####.....#.#####..',
  '.#.#....#.#.#..#....#',
  '##...##.##.#.#..#.##.',
  '.##..#....#....######',
  '#.#####....#.#..#..##',
  '........##.####..#..#',
  '#######.....#.##...#.',
  '#.....#.#..####..##..',
  '#.###.#.##..#..#...#.',
  '#.###.#.##..#..#.##..',
  '#.###.#.#.##.#..###..',
  '#.....#..##....##.#..',
  '#######.####.#..#.##.',
];

const sample = (length: number) =>
  Array.from({ length }, (_, index) => 'ohne:/?=&0123456789ÄÖü'[(index * 7) % 22]).join('');

function formatBits(matrix: boolean[][]): [number, number] {
  const size = matrix.length;
  const read = (cells: [x: number, y: number][]) =>
    cells.reduce((bits, [x, y]) => (bits << 1) | (matrix[y]![x] ? 1 : 0), 0);
  const first: [number, number][] = [
    [0, 8],
    [1, 8],
    [2, 8],
    [3, 8],
    [4, 8],
    [5, 8],
    [7, 8],
    [8, 8],
    [8, 7],
  ];
  for (let y = 5; y >= 0; y -= 1) first.push([8, y]);
  const second: [number, number][] = [];
  for (let y = size - 1; y >= size - 7; y -= 1) second.push([8, y]);
  for (let x = size - 8; x < size; x += 1) second.push([x, 8]);
  return [read(first), read(second)];
}

function reserved(size: number): boolean[][] {
  const version = (size - 17) / 4;
  const grid = Array.from({ length: size }, () => Array.from({ length: size }, () => false));
  const fill = (x0: number, y0: number, width: number, height: number) => {
    for (let y = y0; y < y0 + height; y += 1)
      for (let x = x0; x < x0 + width; x += 1) grid[y]![x] = true;
  };
  fill(0, 0, 9, 9);
  fill(size - 8, 0, 8, 9);
  fill(0, size - 8, 9, 8);
  const centers = ALIGNMENT[version - 1]!;
  for (const x of centers) for (const y of centers) if (!grid[y]![x]) fill(x - 2, y - 2, 5, 5);
  fill(6, 0, 1, size);
  fill(0, 6, size, 1);
  if (version >= 7) {
    fill(size - 11, 0, 3, 6);
    fill(0, size - 11, 6, 3);
  }
  return grid;
}

function decode(matrix: boolean[][]): { text: string; mask: number } {
  const size = matrix.length;
  const version = (size - 17) / 4;
  const mask = FORMAT_M.indexOf(formatBits(matrix)[0]);
  const skip = reserved(size);
  const bits: number[] = [];
  for (let right = size - 1, column = 0; right >= 1; right -= 2, column += 1) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step += 1) {
      const y = column % 2 === 0 ? size - 1 - step : step;
      for (const x of [right, right - 1]) {
        if (!skip[y]![x]) bits.push(Number(matrix[y]![x] !== MASKS[mask]!(x, y)));
      }
    }
  }
  const [total, ecc, count] = BLOCKS[version - 1]!;
  const raw = Array.from({ length: total }, (_, index) =>
    bits.slice(index * 8, index * 8 + 8).reduce((byte, bit) => (byte << 1) | bit, 0),
  );
  const long = total % count;
  const shortLength = Math.floor(total / count) - ecc;
  const blocks = Array.from({ length: count }, () => [] as number[]);
  let at = 0;
  for (let index = 0; index <= shortLength; index += 1) {
    for (const [number, block] of blocks.entries()) {
      if (index < shortLength || number >= count - long) block.push(raw[at++]!);
    }
  }
  for (const block of blocks) {
    deepStrictEqual(
      raw.filter((_, index) => index >= at && (index - at) % count === blocks.indexOf(block)),
      reedSolomon(block, ecc),
    );
  }
  const data = blocks
    .flat()
    .flatMap((byte) => Array.from({ length: 8 }, (_, bit) => (byte >>> (7 - bit)) & 1));
  const take = (length: number) =>
    data.splice(0, length).reduce((value, bit) => value * 2 + bit, 0);
  strictEqual(take(4), 0b0100);
  const length = take(version < 10 ? 8 : 16);
  return {
    text: new TextDecoder().decode(new Uint8Array(Array.from({ length }, () => take(8)))),
    mask,
  };
}

describe('qrMatrix', () => {
  it('computes the ISO 18004 Reed-Solomon reference codewords', () => {
    const data = [
      0x10, 0x20, 0x0c, 0x56, 0x61, 0x80, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec,
      0x11,
    ];
    deepStrictEqual(
      reedSolomon(data, 10),
      [0xa5, 0x24, 0xd4, 0xc1, 0xed, 0x36, 0xc7, 0x87, 0x2c, 0x55],
    );
  });

  it('draws a known 1-M symbol', () => {
    deepStrictEqual(
      qrMatrix('ohne').map((row) => row.map((dark) => (dark ? '#' : '.')).join('')),
      OHNE,
    );
  });

  it('round trips text through every version and mask', () => {
    const masks = new Set<number>();
    for (const length of [0, 14, 15, 26, 42, 62, 84, 106, 122, 152, 180, 213]) {
      const text = 'x'.repeat(length);
      const { text: decoded, mask } = decode(qrMatrix(text));
      strictEqual(decoded, text);
      masks.add(mask);
    }
    for (let number = 0; number < 300; number += 1) {
      const text = String(number);
      const { text: decoded, mask } = decode(qrMatrix(text));
      strictEqual(decoded, text);
      masks.add(mask);
    }
    strictEqual(masks.size, 8);
    strictEqual(decode(qrMatrix(sample(150))).text, sample(150));
  });

  it('picks the smallest version that fits', () => {
    const sizes = [14, 26, 42, 62, 84, 106, 122, 152, 180].map((length) => [
      qrMatrix('x'.repeat(length)).length,
      qrMatrix('x'.repeat(length + 1)).length,
    ]);
    deepStrictEqual(sizes, [
      [21, 25],
      [25, 29],
      [29, 33],
      [33, 37],
      [37, 41],
      [41, 45],
      [45, 49],
      [49, 53],
      [53, 57],
    ]);
  });

  it('draws the finder, timing and dark modules', () => {
    for (const length of [1, 60, 150]) {
      const matrix = qrMatrix(sample(length));
      const size = matrix.length;
      for (const [x0, y0] of [
        [0, 0],
        [size - 7, 0],
        [0, size - 7],
      ] as const) {
        for (let dy = -1; dy <= 7; dy += 1) {
          for (let dx = -1; dx <= 7; dx += 1) {
            const row = matrix[y0 + dy];
            if (row?.[x0 + dx] === undefined) continue;
            const ring = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
            strictEqual(row[x0 + dx], ring !== 2 && ring !== 4);
          }
        }
      }
      for (let index = 8; index < size - 8; index += 1) {
        strictEqual(matrix[6]![index], index % 2 === 0);
        strictEqual(matrix[index]![6], index % 2 === 0);
      }
      strictEqual(matrix[size - 8]![8], true);
    }
  });

  it('writes both format copies as valid BCH codes', () => {
    for (let number = 0; number < 300; number += 1) {
      const [first, second] = formatBits(qrMatrix(String(number)));
      strictEqual(first, second);
      let remainder = (first ^ 0x5412) >>> 10;
      for (let step = 0; step < 10; step += 1)
        remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
      strictEqual(remainder ^ ((first ^ 0x5412) & 0x3ff), 0);
      strictEqual((first ^ 0x5412) >>> 13, 0b00);
    }
  });

  it('writes the version information from version 7', () => {
    for (const [version, length] of [
      [7, 107],
      [8, 123],
      [9, 153],
      [10, 181],
    ] as const) {
      const matrix = qrMatrix('x'.repeat(length));
      const size = matrix.length;
      strictEqual(size, version * 4 + 17);
      let lower = 0;
      let upper = 0;
      for (let index = 17; index >= 0; index -= 1) {
        const a = size - 11 + (index % 3);
        const b = Math.floor(index / 3);
        lower = lower * 2 + Number(matrix[a]![b]);
        upper = upper * 2 + Number(matrix[b]![a]);
      }
      strictEqual(lower, VERSION_INFO[version]);
      strictEqual(upper, VERSION_INFO[version]);
    }
  });

  it('rejects text over 213 bytes', () => {
    throws(() => qrMatrix('x'.repeat(214)), /214 bytes/);
    throws(() => qrMatrix('ä'.repeat(107)), /214 bytes/);
  });
});

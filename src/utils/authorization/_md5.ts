const SHIFTS = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];

const CONSTANTS = Int32Array.from({ length: 64 }, (_, i) =>
  Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32),
);

/**
 * The MD5 digest of `bytes`, per RFC 1321.
 * WebCrypto has no MD5, and SIP digest authentication still needs it.
 */
export function md5(bytes: Uint8Array): Uint8Array {
  const padded = new Uint8Array(Math.ceil((bytes.byteLength + 9) / 64) * 64);
  padded.set(bytes);
  padded[bytes.byteLength] = 0x80;
  const view = new DataView(padded.buffer);
  view.setBigUint64(padded.byteLength - 8, BigInt(bytes.byteLength) * 8n, true);

  const state = Int32Array.from([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476]);
  const words = new Int32Array(16);
  for (let offset = 0; offset < padded.byteLength; offset += 64) {
    for (let i = 0; i < 16; i++) words[i] = view.getInt32(offset + i * 4, true);
    let [a, b, c, d] = state;
    for (let i = 0; i < 64; i++) {
      let mix: number;
      let word: number;
      if (i < 16) [mix, word] = [(b & c) | (~b & d), i];
      else if (i < 32) [mix, word] = [(d & b) | (~d & c), (5 * i + 1) % 16];
      else if (i < 48) [mix, word] = [b ^ c ^ d, (3 * i + 5) % 16];
      else [mix, word] = [c ^ (b | ~d), (7 * i) % 16];
      const sum = (a + mix + CONSTANTS[i] + words[word]) | 0;
      const shift = SHIFTS[(i >> 4) * 4 + (i % 4)];
      [a, b, c, d] = [d, (b + ((sum << shift) | (sum >>> (32 - shift)))) | 0, b, c];
    }
    state[0] += a;
    state[1] += b;
    state[2] += c;
    state[3] += d;
  }

  const digest = new Uint8Array(16);
  const out = new DataView(digest.buffer);
  state.forEach((word, i) => out.setInt32(i * 4, word, true));
  return digest;
}

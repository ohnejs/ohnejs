import { isInteger } from '../is/is-integer.ts';
import { isUndefined } from '../is/is-undefined.ts';

/**
 * A running SHA-256 hash, fed its bytes over any number of calls.
 */
export interface SHA256 {
  /**
   * Feeds `bytes` into the hash.
   */
  update(bytes: Uint8Array): void;

  /**
   * Captures the running hash as a hex string that `createSHA256` resumes from.
   * It holds the hash words, the byte count, and the unfinished block, in at most 206 characters.
   */
  state(): string;

  /**
   * Returns the hex digest of every byte fed so far.
   * The hash stays open, so `update` and `state` keep working after it.
   */
  digest(): string;
}

/**
 * The part of a running hash that `state` captures.
 */
interface Running {
  words: Int32Array;
  count: number;
  tail: Uint8Array;
}

const BLOCK_SIZE = 64;
const COUNT_OFFSET = 32;
const TAIL_OFFSET = 40;

const STATE_RE = /^(?:[\da-f]{2}){40,103}$/;

const INITIAL_HASH = Int32Array.from([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

const ROUND_CONSTANTS = Int32Array.from([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/**
 * Creates a SHA-256 hash whose running state can be saved as text and resumed later.
 * `state()` captures every byte fed so far, and `createSHA256(state)` continues exactly there.
 * The digest equals what `node:crypto` computes for the same bytes.
 *
 * Reach for it when one hash spans several processes, like a file uploaded over separate requests.
 * `createHash` from `node:crypto` is faster, but its state cannot leave the process.
 * A malformed `state` throws.
 *
 * @example
 * ```ts
 * const sha = createSHA256()
 * sha.update(new TextEncoder().encode('ab'))
 * sha.update(new TextEncoder().encode('c'))
 * sha.digest() // -> 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
 *
 * const resumed = createSHA256(sha.state())
 * resumed.digest() === createHash('sha256').update('abc').digest('hex') // -> true
 * ```
 */
export function createSHA256(state?: string): SHA256 {
  const running = isUndefined(state)
    ? { words: INITIAL_HASH.slice(), count: 0, tail: new Uint8Array(BLOCK_SIZE) }
    : parseState(state);
  const schedule = new Int32Array(64);
  const tailView = new DataView(running.tail.buffer);

  return {
    update(bytes) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const pending = running.count % BLOCK_SIZE;
      let offset = 0;
      running.count += bytes.byteLength;
      if (pending > 0) {
        offset = Math.min(BLOCK_SIZE - pending, bytes.byteLength);
        running.tail.set(bytes.subarray(0, offset), pending);
        if (pending + offset < BLOCK_SIZE) return;
        compress(running.words, schedule, tailView, 0);
      }
      for (; offset + BLOCK_SIZE <= bytes.byteLength; offset += BLOCK_SIZE) {
        compress(running.words, schedule, view, offset);
      }
      running.tail.set(bytes.subarray(offset));
    },

    state() {
      const pending = running.count % BLOCK_SIZE;
      const bytes = new Uint8Array(TAIL_OFFSET + pending);
      const view = new DataView(bytes.buffer);
      writeWords(view, running.words);
      view.setBigUint64(COUNT_OFFSET, BigInt(running.count));
      bytes.set(running.tail.subarray(0, pending), TAIL_OFFSET);
      return bytes.toHex();
    },

    digest() {
      const pending = running.count % BLOCK_SIZE;
      const last = new Uint8Array(Math.ceil((pending + 9) / BLOCK_SIZE) * BLOCK_SIZE);
      const view = new DataView(last.buffer);
      last.set(running.tail.subarray(0, pending));
      last[pending] = 0x80;
      view.setBigUint64(last.byteLength - 8, BigInt(running.count) * 8n);
      const words = running.words.slice();
      for (let offset = 0; offset < last.byteLength; offset += BLOCK_SIZE) {
        compress(words, schedule, view, offset);
      }
      const digest = new Uint8Array(32);
      writeWords(new DataView(digest.buffer), words);
      return digest.toHex();
    },
  };
}

/**
 * Reads back a string `state()` returned.
 */
function parseState(state: string): Running {
  if (!STATE_RE.test(state)) throw new Error('Invalid SHA-256 state');
  const bytes = Uint8Array.fromHex(state);
  const view = new DataView(bytes.buffer);
  const count = Number(view.getBigUint64(COUNT_OFFSET));
  if (!isInteger(count) || count % BLOCK_SIZE !== bytes.byteLength - TAIL_OFFSET) {
    throw new Error('Invalid SHA-256 state');
  }
  const tail = new Uint8Array(BLOCK_SIZE);
  tail.set(bytes.subarray(TAIL_OFFSET));
  return { words: Int32Array.from({ length: 8 }, (_, i) => view.getInt32(i * 4)), count, tail };
}

/**
 * Writes `words` big-endian from the start of `view`, four bytes each.
 */
function writeWords(view: DataView, words: Int32Array): void {
  words.forEach((word, i) => view.setInt32(i * 4, word));
}

/**
 * Mixes the 64-byte block at `offset` in `view` into `words`, with `schedule` as scratch space.
 */
function compress(words: Int32Array, schedule: Int32Array, view: DataView, offset: number): void {
  for (let i = 0; i < 16; i++) schedule[i] = view.getInt32(offset + i * 4);
  for (let i = 16; i < 64; i++) {
    const w15 = schedule[i - 15];
    const w2 = schedule[i - 2];
    const s0 = rotateRight(w15, 7) ^ rotateRight(w15, 18) ^ (w15 >>> 3);
    const s1 = rotateRight(w2, 17) ^ rotateRight(w2, 19) ^ (w2 >>> 10);
    schedule[i] = schedule[i - 16] + s0 + schedule[i - 7] + s1;
  }

  let [a, b, c, d, e, f, g, h] = words;
  for (let i = 0; i < 64; i++) {
    const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
    const choice = (e & f) ^ (~e & g);
    const t1 = (h + sum1 + choice + ROUND_CONSTANTS[i] + schedule[i]) | 0;
    const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
    const majority = (a & b) ^ (a & c) ^ (b & c);
    const t2 = (sum0 + majority) | 0;
    [a, b, c, d, e, f, g, h] = [(t1 + t2) | 0, a, b, c, (d + t1) | 0, e, f, g];
  }
  [a, b, c, d, e, f, g, h].forEach((word, i) => {
    words[i] += word;
  });
}

/**
 * Rotates the 32-bit `word` right by `bits`.
 */
function rotateRight(word: number, bits: number): number {
  return (word >>> bits) | (word << (32 - bits));
}

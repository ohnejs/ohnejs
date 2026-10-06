import { strictEqual, throws } from 'node:assert';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';

import { createSHA256 } from '../../../src/utils/crypto/index.ts';

/**
 * Builds `size` bytes of a pattern whose period never lines up with a block.
 */
function pattern(size: number): Uint8Array {
  return Uint8Array.from({ length: size }, (_, i) => (i * 131 + 17) % 251);
}

/**
 * The digest `node:crypto` computes, which every case compares to.
 */
function reference(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Hashes `bytes` in one call.
 */
function hashed(bytes: Uint8Array): string {
  const sha = createSHA256();
  sha.update(bytes);
  return sha.digest();
}

/**
 * Hashes `parts` in order, each by a fresh hash resumed from the state the part before left.
 */
function resumed(...parts: Uint8Array[]): string {
  let state: string | undefined;
  for (const part of parts) {
    const sha = createSHA256(state);
    sha.update(part);
    state = sha.state();
  }
  return createSHA256(state).digest();
}

describe('createSHA256', () => {
  it('matches `node:crypto` for every length from 0 to 200', () => {
    for (let size = 0; size <= 200; size++) {
      const bytes = pattern(size);
      strictEqual(hashed(bytes), reference(bytes), `length ${size}`);
    }
  });

  it('matches `node:crypto` for 1 MiB', () => {
    const bytes = pattern(1024 * 1024);
    strictEqual(hashed(bytes), reference(bytes));
  });

  it('matches `node:crypto` for bytes fed over uneven calls', () => {
    const bytes = pattern(10 * 1024);
    const sha = createSHA256();
    let offset = 0;
    for (const size of [1, 63, 64, 65, 0, 127, 200, 4096]) {
      sha.update(bytes.subarray(offset, offset + size));
      offset += size;
    }
    sha.update(bytes.subarray(offset));
    strictEqual(sha.digest(), reference(bytes));
  });

  it('hashes a view into a larger buffer by its own bytes only', () => {
    const bytes = pattern(300);
    const view = bytes.subarray(3, 290);
    strictEqual(hashed(view), reference(view));
  });

  it('resumes from a state split at every offset from 0 to 200 and around 4 KiB', () => {
    const bytes = pattern(10 * 1024);
    const whole = reference(bytes);
    const splits = [...Array.from({ length: 201 }, (_, i) => i), 4095, 4096, 4097];
    for (const split of splits) {
      strictEqual(
        resumed(bytes.subarray(0, split), bytes.subarray(split)),
        whole,
        `split at ${split}`,
      );
    }
  });

  it('resumes across a three-way split', () => {
    const bytes = pattern(10 * 1024);
    strictEqual(
      resumed(bytes.subarray(0, 63), bytes.subarray(63, 4097), bytes.subarray(4097)),
      reference(bytes),
    );
  });

  it('refuses a malformed state', () => {
    const sha = createSHA256();
    sha.update(pattern(70));
    const state = sha.state();
    const unsafeCount = `${state.slice(0, 64)}ffffffffffffffc0`;
    for (const malformed of [
      '',
      'g'.repeat(80),
      state.slice(0, -1),
      state.slice(0, -2),
      `${state}00`,
      unsafeCount,
    ]) {
      throws(() => createSHA256(malformed), { message: 'Invalid SHA-256 state' }, malformed);
    }
  });

  it('digests twice to the same value and keeps hashing after it', () => {
    const bytes = pattern(100);
    const sha = createSHA256();
    sha.update(bytes.subarray(0, 60));
    strictEqual(sha.digest(), sha.digest());
    strictEqual(sha.digest(), reference(bytes.subarray(0, 60)));
    sha.update(bytes.subarray(60));
    strictEqual(sha.digest(), reference(bytes));
    strictEqual(createSHA256(sha.state()).digest(), reference(bytes));
  });
});

import { match, notStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { truncateWithHash } from '../../../src/utils/crypto/index.ts';

describe('truncateWithHash', () => {
  it('passes a name at or under the cap through unchanged', () => {
    strictEqual(truncateWithHash('Posts'), 'Posts');
    strictEqual(truncateWithHash('a'.repeat(63)), 'a'.repeat(63));
  });

  it('caps an over-long name at exactly the cap', () => {
    strictEqual(truncateWithHash('a'.repeat(64)).length, 63);
    strictEqual(truncateWithHash('a'.repeat(200)).length, 63);
  });

  it('keeps the head and appends `$` plus 8 hex chars', () => {
    match(truncateWithHash('a'.repeat(100)), /^a{54}\$[0-9a-f]{8}$/);
  });

  it('hashes the full name, not the kept head', () => {
    const shared = 'a'.repeat(60);
    notStrictEqual(truncateWithHash(`${shared}bbbb`), truncateWithHash(`${shared}cccc`));
  });

  it('is deterministic', () => {
    strictEqual(truncateWithHash('b'.repeat(100)), truncateWithHash('b'.repeat(100)));
  });

  it('is idempotent over its own output', () => {
    const truncated = truncateWithHash('c'.repeat(100));
    strictEqual(truncateWithHash(truncated), truncated);
  });

  it('honors a custom cap', () => {
    strictEqual(truncateWithHash('d'.repeat(30), 30), 'd'.repeat(30));
    strictEqual(truncateWithHash('d'.repeat(40), 30).length, 30);
    match(truncateWithHash('d'.repeat(40), 30), /^d{21}\$[0-9a-f]{8}$/);
  });

  it('keeps the head from the start when the cap cannot fit the marker', () => {
    match(truncateWithHash('e'.repeat(40), 4), /^\$[0-9a-f]{8}$/);
    strictEqual(truncateWithHash('e'.repeat(40), 4), truncateWithHash('e'.repeat(40), 4));
  });
});

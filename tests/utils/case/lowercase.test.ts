import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { lowercase } from '../../../src/utils/index.ts';

describe('lowercase', () => {
  it('lowercases every script', () => {
    strictEqual(lowercase('Dalaran.Example'), 'dalaran.example');
    strictEqual(lowercase('MÜNCHEN'), 'münchen');
    strictEqual(lowercase('İ'), 'i̇');
  });

  it('lowercases a final sigma to `σ`, as IDNA does', () => {
    strictEqual(lowercase('ΟΔΟΣ'), 'οδοσ');
    strictEqual(lowercase('ΚΑΛΟΣ-ΗΡΘΕΣ'), 'καλοσ-ηρθεσ');
  });

  it('keeps a typed `ς`, `ß` and compatibility forms', () => {
    strictEqual(lowercase('οδος'), 'οδος');
    strictEqual(lowercase('ẞ'), 'ß');
    strictEqual(lowercase('ＡＢ'), 'ａｂ');
  });

  it('composes the result to NFC', () => {
    strictEqual(lowercase('CAFÉ'), 'café');
  });
});

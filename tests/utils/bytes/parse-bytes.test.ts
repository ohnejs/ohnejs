import { strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { parseBytes } from '../../../src/utils/index.ts';

describe('parseBytes', () => {
  describe('numbers', () => {
    it('passes whole non-negative numbers through unchanged', () => {
      strictEqual(parseBytes(0), 0);
      strictEqual(parseBytes(2048), 2048);
    });

    it('rounds a fractional number to whole bytes', () => {
      strictEqual(parseBytes(5242880.5), 5242881);
      strictEqual(parseBytes(0.4), 0);
    });

    it('throws on negative, NaN, and Infinity', () => {
      throws(() => parseBytes(-1), /Invalid byte size/);
      throws(() => parseBytes(NaN), /Invalid byte size/);
      throws(() => parseBytes(Infinity), /Invalid byte size/);
    });
  });

  describe('strings', () => {
    it('reads a bare number as bytes', () => {
      strictEqual(parseBytes('512'), 512);
    });

    it('parses binary units', () => {
      strictEqual(parseBytes('1kb'), 1024);
      strictEqual(parseBytes('1mb'), 1024 ** 2);
      strictEqual(parseBytes('1gb'), 1024 ** 3);
      strictEqual(parseBytes('1tb'), 1024 ** 4);
    });

    it('accepts unit aliases, case-insensitively, with surrounding space', () => {
      strictEqual(parseBytes('1KB'), 1024);
      strictEqual(parseBytes('1 kib'), 1024);
      strictEqual(parseBytes('1k'), 1024);
      strictEqual(parseBytes(' 2 bytes '), 2);
    });

    it('rounds a fractional result to whole bytes', () => {
      strictEqual(parseBytes('1.5kb'), 1536);
      strictEqual(parseBytes('0.5b'), 1);
    });

    it('throws on an unknown unit or unparseable string', () => {
      throws(() => parseBytes('10xb'), /Invalid byte size/);
      throws(() => parseBytes('big'), /Invalid byte size/);
      throws(() => parseBytes(''), /Invalid byte size/);
    });
  });
});

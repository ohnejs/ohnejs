import { strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { parseString } from '../../../src/utils/index.ts';

describe('parseString', () => {
  it('returns strings unchanged', () => {
    strictEqual(parseString('hi'), 'hi');
    strictEqual(parseString(''), '');
  });

  it('parses numbers via String()', () => {
    strictEqual(parseString(42), '42');
    strictEqual(parseString(-1.5), '-1.5');
    strictEqual(parseString(NaN), 'NaN');
    strictEqual(parseString(Infinity), 'Infinity');
  });

  it('parses booleans via String()', () => {
    strictEqual(parseString(true), 'true');
    strictEqual(parseString(false), 'false');
  });

  it('parses bigints via String()', () => {
    strictEqual(parseString(42n), '42');
    strictEqual(parseString(0n), '0');
  });

  it('throws on null, undefined', () => {
    throws(() => parseString(null), /Expected string/);
    throws(() => parseString(undefined), /Expected string/);
  });

  it('throws on arrays and objects', () => {
    throws(() => parseString([1, 2]), /Expected string/);
    throws(() => parseString({ a: 1 }), /Expected string/);
  });
});

import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { parseContentRange } from '../../../src/utils/index.ts';

describe('parseContentRange', () => {
  it('parses a range with a known size', () => {
    deepStrictEqual(parseContentRange('bytes 0-499/1000'), { start: 0, end: 499, size: 1000 });
  });

  it('parses a range with an unknown size', () => {
    deepStrictEqual(parseContentRange('bytes 500-999/*'), { start: 500, end: 999 });
  });

  it('parses an unsatisfied range as the size alone', () => {
    deepStrictEqual(parseContentRange('bytes */1000'), { size: 1000 });
  });

  it('parses a one-byte range at the end', () => {
    deepStrictEqual(parseContentRange('bytes 999-999/1000'), { start: 999, end: 999, size: 1000 });
  });

  it('rejects inverted ranges, ranges past the size, and unknown both', () => {
    strictEqual(parseContentRange('bytes 500-0/1000'), null);
    strictEqual(parseContentRange('bytes 0-1000/1000'), null);
    strictEqual(parseContentRange('bytes */*'), null);
  });

  it('rejects malformed headers and other units', () => {
    strictEqual(parseContentRange(''), null);
    strictEqual(parseContentRange('bytes 0-/1000'), null);
    strictEqual(parseContentRange('bytes=0-499/1000'), null);
    strictEqual(parseContentRange('items 0-9/10'), null);
  });
});

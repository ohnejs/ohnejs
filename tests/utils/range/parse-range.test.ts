import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { parseRange } from '../../../src/utils/index.ts';

describe('parseRange', () => {
  it('parses a closed range', () => {
    deepStrictEqual(parseRange('bytes=0-499', 1000), {
      type: 'satisfiable',
      ranges: [{ start: 0, end: 499 }],
    });
  });

  it('runs an open range to the last byte', () => {
    deepStrictEqual(parseRange('bytes=500-', 1000), {
      type: 'satisfiable',
      ranges: [{ start: 500, end: 999 }],
    });
  });

  it('reads a suffix range as the last N bytes', () => {
    deepStrictEqual(parseRange('bytes=-200', 1000), {
      type: 'satisfiable',
      ranges: [{ start: 800, end: 999 }],
    });
  });

  it('clamps a suffix larger than the size to the whole representation', () => {
    deepStrictEqual(parseRange('bytes=-5000', 1000), {
      type: 'satisfiable',
      ranges: [{ start: 0, end: 999 }],
    });
  });

  it('clamps an end past the last byte', () => {
    deepStrictEqual(parseRange('bytes=900-5000', 1000), {
      type: 'satisfiable',
      ranges: [{ start: 900, end: 999 }],
    });
  });

  it('parses multiple ranges in order', () => {
    deepStrictEqual(parseRange('bytes=0-0,-1', 1000), {
      type: 'satisfiable',
      ranges: [
        { start: 0, end: 0 },
        { start: 999, end: 999 },
      ],
    });
  });

  it('skips an out-of-bounds range but keeps the satisfiable ones', () => {
    deepStrictEqual(parseRange('bytes=0-99,5000-6000', 1000), {
      type: 'satisfiable',
      ranges: [{ start: 0, end: 99 }],
    });
  });

  it('is unsatisfiable when the start is at or past the size', () => {
    deepStrictEqual(parseRange('bytes=1000-', 1000), { type: 'unsatisfiable' });
  });

  it('is unsatisfiable for a zero-length suffix', () => {
    deepStrictEqual(parseRange('bytes=-0', 1000), { type: 'unsatisfiable' });
  });

  it('is unsatisfiable when the end precedes the start', () => {
    deepStrictEqual(parseRange('bytes=500-100', 1000), { type: 'unsatisfiable' });
  });

  it('ignores an unknown unit', () => {
    deepStrictEqual(parseRange('items=0-9', 1000), { type: 'ignore' });
  });

  it('ignores a header with no unit separator', () => {
    deepStrictEqual(parseRange('0-499', 1000), { type: 'ignore' });
  });

  it('ignores a non-numeric position', () => {
    deepStrictEqual(parseRange('bytes=a-z', 1000), { type: 'ignore' });
  });

  it('ignores a bare dash', () => {
    deepStrictEqual(parseRange('bytes=-', 1000), { type: 'ignore' });
  });

  it('ignores an empty range set', () => {
    deepStrictEqual(parseRange('bytes=', 1000), { type: 'ignore' });
  });
});

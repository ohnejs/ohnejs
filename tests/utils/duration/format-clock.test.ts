import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { formatClock } from '../../../src/utils/index.ts';

describe('formatClock', () => {
  it('reads `m:ss` below an hour', () => {
    strictEqual(formatClock(0), '0:00');
    strictEqual(formatClock(999), '0:00');
    strictEqual(formatClock(65_000), '1:05');
    strictEqual(formatClock(3_599_999), '59:59');
  });

  it('reads `h:mm:ss` from one hour on', () => {
    strictEqual(formatClock(3_600_000), '1:00:00');
    strictEqual(formatClock(3_725_000), '1:02:05');
  });

  it('clamps a negative duration to `0:00`', () => {
    strictEqual(formatClock(-500), '0:00');
  });
});

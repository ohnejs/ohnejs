import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { durationText } from '../../../src/utils/index.ts';

describe('durationText', () => {
  it('writes a duration in canonical form', () => {
    strictEqual(durationText(5_400_000), '1h 30m');
    strictEqual(durationText('90m'), '1h 30m');
  });

  it('gives any other value back as text', () => {
    strictEqual(durationText(-1), '-1');
    strictEqual(durationText('soon'), 'soon');
  });
});

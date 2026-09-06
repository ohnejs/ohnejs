import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { smoothstep } from '../../../src/utils/index.ts';

describe('smoothstep', () => {
  it('pins the ends', () => {
    strictEqual(smoothstep(0), 0);
    strictEqual(smoothstep(1), 1);
  });

  it('crosses the midpoint at a half', () => {
    strictEqual(smoothstep(0.5), 0.5);
  });

  it('follows the Hermite curve', () => {
    strictEqual(smoothstep(0.25), 0.15625);
    strictEqual(smoothstep(0.75), 0.84375);
  });

  it('clamps input outside `[0, 1]`', () => {
    strictEqual(smoothstep(-2), 0);
    strictEqual(smoothstep(1.7), 1);
  });
});

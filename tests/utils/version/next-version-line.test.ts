import { strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { nextVersionLine } from '../../../src/utils/index.ts';

describe('nextVersionLine', () => {
  it('steps the minor before 1.0 and the major from then on', () => {
    strictEqual(nextVersionLine('0.0.2'), '0.1.0');
    strictEqual(nextVersionLine('0.1.4'), '0.2.0');
    strictEqual(nextVersionLine('0.9.0-beta.1'), '0.10.0');
    strictEqual(nextVersionLine('1.0.0'), '2.0.0');
    strictEqual(nextVersionLine('2.7.3'), '3.0.0');
  });

  it('throws on a string that is not a version', () => {
    throws(() => nextVersionLine('x'), /`x` is not a version/);
  });
});

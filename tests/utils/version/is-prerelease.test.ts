import { strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { isPrerelease } from '../../../src/utils/index.ts';

describe('isPrerelease', () => {
  it('tells a prerelease from a release', () => {
    strictEqual(isPrerelease('1.0.0-0'), true);
    strictEqual(isPrerelease('1.0.0'), false);
  });

  it('throws on a string that is not a version', () => {
    throws(() => isPrerelease('x'), /`x` is not a version/);
  });
});

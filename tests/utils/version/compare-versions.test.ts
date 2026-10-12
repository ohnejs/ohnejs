import { deepStrictEqual, strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { compareVersions } from '../../../src/utils/index.ts';

describe('compareVersions', () => {
  it('orders prereleases before their release, as semver does', () => {
    const chain = [
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0',
    ];
    deepStrictEqual([...chain].reverse().sort(compareVersions), chain);
  });

  it('compares numbers numerically and answers `0` for equal versions', () => {
    strictEqual(compareVersions('0.9.0', '0.10.0') < 0, true);
    strictEqual(compareVersions('2.0.0', '1.9.9') > 0, true);
    strictEqual(compareVersions('0.1.0', '0.1.0'), 0);
  });

  it('throws on a string that is not a version', () => {
    throws(() => compareVersions('1.0.0', 'x'), /`x` is not a version/);
  });
});

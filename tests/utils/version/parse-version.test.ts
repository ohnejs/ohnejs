import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { parseVersion } from '../../../src/utils/index.ts';

describe('parseVersion', () => {
  it('reads a release and a prerelease', () => {
    deepStrictEqual(parseVersion('1.2.3'), { major: 1, minor: 2, patch: 3, prerelease: [] });
    deepStrictEqual(parseVersion('0.0.0'), { major: 0, minor: 0, patch: 0, prerelease: [] });
    deepStrictEqual(parseVersion('1.0.0-0a.0')?.prerelease, ['0a', '0']);
    deepStrictEqual(parseVersion('1.0.0-beta.1'), {
      major: 1,
      minor: 0,
      patch: 0,
      prerelease: ['beta', '1'],
    });
  });

  it('answers `undefined` for anything but a plain version', () => {
    const others = [
      'v1.2.3',
      '1.2',
      '01.2.3',
      '1.0.0-beta.01',
      '1.0.0-01',
      '1.2.3+build',
      '^1.2.3',
    ];
    for (const text of [...others, '1.2.3-', '']) {
      strictEqual(parseVersion(text), undefined, text);
    }
  });
});

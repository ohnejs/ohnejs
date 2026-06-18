import { ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { detectPlatform } from '../../../src/utils/index.ts';

describe('detectPlatform', () => {
  it('maps the current Node process platform', () => {
    const expected =
      process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux';
    strictEqual(detectPlatform(), expected);
  });

  it('returns one of the known families', () => {
    ok(['mac', 'win', 'linux'].includes(detectPlatform()));
  });
});

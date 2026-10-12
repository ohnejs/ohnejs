import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { admitsVersion, parsePeerRange } from '../../../src/utils/index.ts';

/**
 * Whether the range written as `text` takes `version`.
 */
function admits(text: string, version: string): boolean {
  return admitsVersion(parsePeerRange(text)!, version);
}

describe('admitsVersion', () => {
  it('takes a release from the floor up to, not including, the ceiling', () => {
    strictEqual(admits('>=0.1.0 <0.2.0-0', '0.1.0'), true);
    strictEqual(admits('>=0.1.0 <0.2.0-0', '0.1.9'), true);
    strictEqual(admits('>=0.1.0 <0.2.0-0', '0.2.0'), false);
    strictEqual(admits('>=0.1.0 <0.2.0-0', '0.0.9'), false);
  });

  it('leaves the next line out of a lone `>=`', () => {
    strictEqual(admits('>=0.0.2', '0.0.3'), true);
    strictEqual(admits('>=0.0.2', '0.1.0'), false);
    strictEqual(admits('>=0.0.1', '0.1.0'), false);
  });

  it("leaves out a prerelease no bound names, the ceiling's own included", () => {
    for (const version of ['0.2.0-0', '0.2.0-beta.1', '0.1.1-beta.0', '0.1.0-beta.1']) {
      strictEqual(admits('>=0.1.0 <0.2.0-0', version), false, version);
    }
    strictEqual(admits('>=0.1.0 <0.2.0', '0.2.0-0'), false);
  });

  it('takes a prerelease a bound names, as npm does', () => {
    strictEqual(admits('>=0.2.0-beta.1 <0.3.0-0', '0.2.0-beta.1'), true);
    strictEqual(admits('>=0.2.0-beta.1 <0.3.0-0', '0.2.0-beta.2'), true);
    strictEqual(admits('>=0.2.0-beta.1 <0.3.0-0', '0.2.0-alpha.1'), false);
    strictEqual(admits('>=0.2.0-0 <0.3.0-0', '0.2.0-rc.1'), true);
    strictEqual(admits('>=0.1.0 <0.2.0-10', '0.2.0-5'), true);
  });

  it('takes only the version an exact range names', () => {
    strictEqual(admits('0.2.0-beta.1', '0.2.0-beta.1'), true);
    strictEqual(admits('0.2.0-beta.1', '0.2.0-beta.2'), false);
    strictEqual(admits('0.2.0-beta.1', '0.2.0'), false);
  });
});

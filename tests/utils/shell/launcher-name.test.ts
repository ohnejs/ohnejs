import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { launcherName } from '../../../src/utils/index.ts';

describe('launcherName', () => {
  it('reads the package manager from the first token', () => {
    const cases: [string, string][] = [
      ['npm/11.16.0 node/v26.3.0 darwin arm64 workspaces/false', 'npm'],
      ['pnpm/11.5.1 npm/? node/v26.3.0 darwin arm64', 'pnpm'],
      ['yarn/4.9.2 npm/? node/v26.3.0 darwin arm64', 'yarn'],
      ['bun/1.2.19 npm/? node/v24.3.0 darwin arm64', 'bun'],
      ['deno/2.4.2 npm/? deno/2.4.2 darwin arm64', 'deno'],
    ];
    for (const [userAgent, name] of cases) strictEqual(launcherName(userAgent), name, userAgent);
  });

  it('returns `undefined` for an absent or empty user agent', () => {
    strictEqual(launcherName(undefined), undefined);
    strictEqual(launcherName(''), undefined);
  });
});

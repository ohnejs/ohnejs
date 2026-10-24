import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isTypeScriptPath } from '../../../src/utils/index.ts';

describe('isTypeScriptPath', () => {
  it('accepts a .ts or .mts file', () => {
    strictEqual(isTypeScriptPath('pages/home.ts'), true);
    strictEqual(isTypeScriptPath('/srv/boot.mts'), true);
    strictEqual(isTypeScriptPath('pages/users/[id].ts'), true);
  });

  it('rejects any other file', () => {
    for (const path of ['font.woff2', 'module.js', 'types.cts', 'ts', '.ts', 'notes.ts.md']) {
      strictEqual(isTypeScriptPath(path), false);
    }
  });
});

import { strictEqual } from 'node:assert';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { ohne } from '../../../../src/ohne/cli/ohne.ts';
import { useEnv } from '../../../../src/ohne/index.ts';
import { runCommand } from '../../../../src/utils/cli/index.ts';

describe('ohne dev', () => {
  let root: string;

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'ohne-dev-cli-'));
    useEnv().set('SILENT', true);
    process.exitCode = 0;
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
    useEnv().unset('SILENT');
    process.exitCode = 0;
  });

  it('refuses to run outside an ohne project', async () => {
    const dir = mkdtempSync(join(root, 'plain-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'plain' }));

    await runCommand(ohne, ['dev', '--cwd', dir]);
    strictEqual(process.exitCode, 1);
    strictEqual(existsSync(join(dir, '.ohne')), false);
  });
});

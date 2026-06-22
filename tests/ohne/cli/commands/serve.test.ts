import { strictEqual } from 'node:assert';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { ohne } from '../../../../src/ohne/cli/ohne.ts';
import { useEnv } from '../../../../src/ohne/index.ts';
import { runCommand } from '../../../../src/utils/cli/index.ts';

describe('ohne serve api', () => {
  let root: string;

  function makeDir(name: string, ohneProject: boolean): string {
    const dir = mkdtempSync(join(root, `${name}-`));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name }));
    if (ohneProject) writeFileSync(join(dir, 'ohne.config.ts'), '');
    return dir;
  }

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'ohne-serve-'));
    useEnv().set('SILENT', true);
    process.exitCode = 0;
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
    useEnv().unset('SILENT');
    process.exitCode = 0;
  });

  it('boots and generates the codegen files for an ohne project', async () => {
    const dir = makeDir('app', true);

    const code = await runCommand(ohne, ['serve', 'api', '--cwd', dir]);
    strictEqual(code, 0);
    strictEqual(process.exitCode, 0);
    strictEqual(existsSync(join(dir, '.ohne', 'layer-name.ts')), true);
  });

  it('refuses to run outside an ohne project', async () => {
    const dir = makeDir('plain', false);

    await runCommand(ohne, ['serve', 'api', '--cwd', dir]);
    strictEqual(process.exitCode, 1);
    strictEqual(existsSync(join(dir, '.ohne')), false);
  });
});

import { strictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { resolveModuleDir } from '../../../src/utils/fs/index.ts';
import { normalizePath } from '../../../src/utils/index.ts';

function makePackage(dir: string, name: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name }));
}

describe('resolveModuleDir', () => {
  let dir: string;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'ohne-resolve-module-'));
    // app/node_modules/dep, plus a nested consumer with no local node_modules.
    makePackage(join(dir, 'app', 'node_modules', 'dep'), 'dep');
    makePackage(join(dir, 'app', 'node_modules', '@scope', 'pkg'), '@scope/pkg');
    mkdirSync(join(dir, 'app', 'src', 'deep'), { recursive: true });
    // A pnpm-style symlink: app/node_modules/linked -> store/linked.
    makePackage(join(dir, 'store', 'linked'), 'linked');
    if (process.platform !== 'win32') {
      symlinkSync(join(dir, 'store', 'linked'), join(dir, 'app', 'node_modules', 'linked'));
    }
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('resolves a package in the start directory', async () => {
    const found = await resolveModuleDir('dep', join(dir, 'app'));
    strictEqual(found?.endsWith('/app/node_modules/dep'), true);
  });

  it('walks up to a hoisted package, skipping node_modules segments', async () => {
    const found = await resolveModuleDir('dep', join(dir, 'app', 'src', 'deep'));
    strictEqual(found?.endsWith('/app/node_modules/dep'), true);
  });

  it('resolves scoped names', async () => {
    const found = await resolveModuleDir('@scope/pkg', join(dir, 'app'));
    strictEqual(found?.endsWith('/app/node_modules/@scope/pkg'), true);
  });

  it(
    'collapses symlinks to the real store path',
    { skip: process.platform === 'win32' },
    async () => {
      const found = await resolveModuleDir('linked', join(dir, 'app'));
      strictEqual(found, normalizePath(realpathSync(join(dir, 'store', 'linked'))));
    },
  );

  it('returns null for a package that is not installed', async () => {
    strictEqual(await resolveModuleDir('missing', join(dir, 'app')), null);
  });
});

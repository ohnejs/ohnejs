import { deepStrictEqual, rejects } from 'node:assert';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { scanLayerRoles } from '../../../src/ohne/index.ts';

describe('scanLayerRoles', () => {
  let root: string;

  function writeRole(dir: string, relative: string): string {
    const file = join(dir, 'roles', relative);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, "export default { capabilities: ['*'] };\n");
    return file;
  }

  before(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'ohne-scan-roles-')));
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('names each role by its kebab-case path, sorted by file path', async () => {
    const dir = join(root, 'named');
    writeRole(dir, 'editor.ts');
    writeRole(dir, 'shop/Manager.ts');
    const scanned = await scanLayerRoles({ name: 'app', dir }, 'roles');
    deepStrictEqual(
      scanned.map((role) => role.name),
      ['editor', 'shop-manager'],
    );
  });

  it('skips `_`-prefixed files and directories', async () => {
    const dir = join(root, 'skipped');
    writeRole(dir, 'editor.ts');
    writeRole(dir, '_draft.ts');
    writeRole(dir, '_shared/admin.ts');
    const scanned = await scanLayerRoles({ name: 'app', dir }, 'roles');
    deepStrictEqual(
      scanned.map((role) => role.name),
      ['editor'],
    );
  });

  it('rejects two files resolving to the same name', async () => {
    const dir = join(root, 'clash');
    writeRole(dir, 'shop-manager.ts');
    writeRole(dir, 'shop/manager.ts');
    await rejects(scanLayerRoles({ name: 'app', dir }, 'roles'), /Duplicate role `shop-manager`/);
  });

  it('returns an empty list when the layer has no roles directory', async () => {
    deepStrictEqual(await scanLayerRoles({ name: 'app', dir: join(root, 'none') }, 'roles'), []);
  });
});

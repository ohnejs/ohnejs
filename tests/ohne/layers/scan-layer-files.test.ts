import { deepStrictEqual, rejects } from 'node:assert';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { scanLayerFiles } from '../../../src/ohne/index.ts';

describe('scanLayerFiles', () => {
  let root: string;

  function writeRole(dir: string, relative: string): string {
    const file = join(dir, 'roles', relative);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, "export default { capabilities: ['*'] };\n");
    return file;
  }

  before(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'ohne-scan-files-')));
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('names each file by its kebab-case path, sorted by file path', async () => {
    const dir = join(root, 'named');
    const editor = writeRole(dir, 'editor.ts');
    const manager = writeRole(dir, 'shop/Manager.ts');
    const scanned = await scanLayerFiles('role', { name: 'app', dir }, 'roles');
    deepStrictEqual(scanned, [
      { name: 'editor', file: editor },
      { name: 'shop-manager', file: manager },
    ]);
  });

  it('reads the directory it is given', async () => {
    const dir = join(root, 'custom');
    const file = join(dir, 'skills', 'translate.ts');
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, 'export default {};\n');
    deepStrictEqual(await scanLayerFiles('skill', { name: 'app', dir }, 'skills'), [
      { name: 'translate', file },
    ]);
    deepStrictEqual(await scanLayerFiles('skill', { name: 'app', dir }, 'roles'), []);
  });

  it('skips `_`-prefixed files and directories', async () => {
    const dir = join(root, 'skipped');
    writeRole(dir, 'editor.ts');
    writeRole(dir, '_draft.ts');
    writeRole(dir, '_shared/admin.ts');
    const scanned = await scanLayerFiles('role', { name: 'app', dir }, 'roles');
    deepStrictEqual(
      scanned.map((entry) => entry.name),
      ['editor'],
    );
  });

  it('rejects two files resolving to the same name, naming the kind', async () => {
    const dir = join(root, 'clash');
    writeRole(dir, 'shop-manager.ts');
    writeRole(dir, 'shop/manager.ts');
    await rejects(
      scanLayerFiles('role', { name: 'app', dir }, 'roles'),
      /Duplicate role `shop-manager`/,
    );
    await rejects(
      scanLayerFiles('skill', { name: 'app', dir }, 'roles'),
      /Duplicate skill `shop-manager`/,
    );
  });

  it('returns an empty list when the layer has no such directory', async () => {
    const layer = { name: 'app', dir: join(root, 'none') };
    deepStrictEqual(await scanLayerFiles('role', layer, 'roles'), []);
  });
});

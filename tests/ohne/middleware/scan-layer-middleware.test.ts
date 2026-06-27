import { deepStrictEqual, rejects } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { type OhneLayer, scanLayerMiddleware } from '../../../src/ohne/index.ts';

describe('scanLayerMiddleware', () => {
  let root: string;
  let dep: OhneLayer;

  function writeMiddleware(layerDir: string, relative: string): void {
    const file = join(layerDir, 'middleware', relative);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, 'export default () => undefined\n');
  }

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'ohne-scan-layer-middleware-'));
    dep = { name: 'dep', dir: join(root, 'dep') };
    writeMiddleware(dep.dir, '10-auth.ts');
    writeMiddleware(dep.dir, 'admin/guard.ts');
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('maps each file in a layer to a named middleware', async () => {
    const middleware = await scanLayerMiddleware(dep, 'middleware');
    deepStrictEqual(
      middleware.map((entry) => ({ name: entry.name, layer: entry.layer })),
      [
        { name: '10-auth', layer: 'dep' },
        { name: 'admin-guard', layer: 'dep' },
      ],
    );
  });

  it('returns an empty list when a layer has no middleware directory', async () => {
    deepStrictEqual(
      await scanLayerMiddleware({ name: 'bare', dir: join(root, 'bare') }, 'middleware'),
      [],
    );
  });

  it('throws when two files resolve to the same name', async () => {
    const clashing: OhneLayer = { name: 'clash', dir: join(root, 'clash') };
    writeMiddleware(clashing.dir, 'foo-bar.ts');
    writeMiddleware(clashing.dir, 'foo/bar.ts');
    await rejects(scanLayerMiddleware(clashing, 'middleware'), /Duplicate middleware `foo-bar`/);
  });
});

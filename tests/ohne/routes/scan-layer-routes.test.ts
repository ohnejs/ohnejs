import { deepStrictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { type OhneLayer, scanLayerRoutes } from '../../../src/ohne/index.ts';

describe('scanLayerRoutes', () => {
  let root: string;
  let dep: OhneLayer;

  function writeRoute(layerDir: string, relative: string): void {
    const file = join(layerDir, 'api', relative);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, 'export default () => null\n');
  }

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'ohne-scan-layer-routes-'));
    dep = { name: 'dep', dir: join(root, 'dep') };
    writeRoute(dep.dir, 'index.get.ts');
    writeRoute(dep.dir, 'users/[id].get.ts');
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('maps each file in a layer to a route', async () => {
    const routes = await scanLayerRoutes(dep, 'api');
    deepStrictEqual(
      routes.map((route) => ({ method: route.method, pattern: route.pattern, layer: route.layer })),
      [
        { method: 'GET', pattern: '/', layer: 'dep' },
        { method: 'GET', pattern: '/users/[id]', layer: 'dep' },
      ],
    );
  });

  it('returns an empty list when a layer has no api directory', async () => {
    deepStrictEqual(await scanLayerRoutes({ name: 'bare', dir: join(root, 'bare') }, 'api'), []);
  });
});

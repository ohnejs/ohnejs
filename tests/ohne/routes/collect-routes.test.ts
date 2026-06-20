import { deepStrictEqual, strictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { collectRoutes, type OhneLayer, useLayers } from '../../../src/ohne/index.ts';

describe('collectRoutes', () => {
  let root: string;
  let dep: OhneLayer;
  let app: OhneLayer;

  function writeRoute(layerDir: string, relative: string, api = 'api'): void {
    const file = join(layerDir, api, relative);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, 'export default () => null\n');
  }

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'ohne-collect-routes-'));
    dep = { name: 'dep', dir: join(root, 'dep') };
    app = { name: 'app', dir: join(root, 'app') };
    writeRoute(dep.dir, 'index.get.ts');
    writeRoute(dep.dir, 'users/[id].get.ts');
    writeRoute(app.dir, 'users/[id].get.ts');
    writeRoute(app.dir, 'health.ts');
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('lets a closer layer override an earlier route', async () => {
    const routes = await collectRoutes([dep, app]);
    const overridden = routes.find((route) => route.pattern === '/users/[id]');
    strictEqual(overridden?.layer, 'app');
  });

  it('combines the routes of every layer', async () => {
    const routes = await collectRoutes([dep, app]);
    deepStrictEqual(
      routes.map((route) => (route.method ? `${route.method} ${route.pattern}` : route.pattern)),
      ['/health', 'GET /', 'GET /users/[id]'],
    );
  });

  it('drops routes matching a method-agnostic disable glob', async () => {
    const routes = await collectRoutes([dep, app], { disable: ['/users/**'] });
    strictEqual(
      routes.some((route) => route.pattern === '/users/[id]'),
      false,
    );
  });

  it('drops only the named method for a method-qualified disable glob', async () => {
    const kept = await collectRoutes([dep, app], { disable: ['POST /users/[id]'] });
    strictEqual(
      kept.some((route) => route.pattern === '/users/[id]'),
      true,
    );

    const dropped = await collectRoutes([dep, app], { disable: ['GET /users/[id]'] });
    strictEqual(
      dropped.some((route) => route.pattern === '/users/[id]'),
      false,
    );
  });

  it('scans each layer in its own configured api directory', async () => {
    const layers = useLayers();
    layers.add({ path: app.dir, input: { dirs: { api: 'routes' } } });
    try {
      writeRoute(app.dir, 'ping.ts', 'routes');
      const patterns = (await collectRoutes([app])).map((route) => route.pattern);
      deepStrictEqual(patterns.includes('/ping'), true);
      deepStrictEqual(patterns.includes('/health'), false);
    } finally {
      layers.remove(app.dir);
    }
  });
});

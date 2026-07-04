import { deepStrictEqual, rejects, strictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { collectMiddleware, type OhneLayer, useLayers } from '../../../src/ohne/index.ts';

describe('collectMiddleware', () => {
  let root: string;
  let dep: OhneLayer;
  let app: OhneLayer;

  function writeMiddleware(layerDir: string, relative: string): void {
    const file = join(layerDir, 'middleware', relative);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, 'export default () => undefined\n');
  }

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'ohne-collect-middleware-'));
    dep = { name: 'dep', dir: join(root, 'dep') };
    app = { name: 'app', dir: join(root, 'app') };
    writeMiddleware(dep.dir, '10-auth.ts');
    writeMiddleware(dep.dir, '20-locale.ts');
    writeMiddleware(dep.dir, 'global/audit.ts');
    writeMiddleware(app.dir, '20-locale.ts');
    writeMiddleware(app.dir, 'global/track.ts');
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('lets a closer layer override a same-named middleware', async () => {
    const middleware = await collectMiddleware([dep, app]);
    const overridden = middleware.find((entry) => entry.name === '20-locale');
    strictEqual(overridden?.layer, 'app');
  });

  it('orders global middleware first, then named, flagging each', async () => {
    const middleware = await collectMiddleware([dep, app]);
    deepStrictEqual(
      middleware.map((entry) => ({ name: entry.name, isGlobal: entry.isGlobal })),
      [
        { name: 'global-audit', isGlobal: true },
        { name: 'global-track', isGlobal: true },
        { name: '10-auth', isGlobal: false },
        { name: '20-locale', isGlobal: false },
      ],
    );
  });

  it('scans each layer in its own configured middleware directory', async () => {
    const layers = useLayers();
    layers.add({ path: app.dir, input: { dirs: { middleware: 'mw' } } });
    try {
      mkdirSync(join(app.dir, 'mw'), { recursive: true });
      writeFileSync(join(app.dir, 'mw', 'ping.ts'), 'export default () => undefined\n');
      const names = (await collectMiddleware([app])).map((entry) => entry.name);
      strictEqual(names.includes('ping'), true);
      strictEqual(names.includes('20-locale'), false);
    } finally {
      layers.remove(app.dir);
    }
  });

  it('throws when a name is global in one layer and named in another', async () => {
    const base: OhneLayer = { name: 'base', dir: join(root, 'base') };
    const over: OhneLayer = { name: 'over', dir: join(root, 'over') };
    writeMiddleware(base.dir, 'global/secure.ts');
    writeMiddleware(over.dir, 'global-secure.ts');
    await rejects(
      collectMiddleware([base, over]),
      /`global-secure` is global in one layer, named in another/,
    );
  });
});

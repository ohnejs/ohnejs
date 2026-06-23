import { deepStrictEqual, strictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { collectMiddleware, type OhneLayer } from '../../../src/ohne/index.ts';

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
    writeMiddleware(app.dir, '20-locale.ts');
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('lets a closer layer override a same-named middleware', async () => {
    const middleware = await collectMiddleware([dep, app]);
    const overridden = middleware.find((entry) => entry.name === '20-locale');
    strictEqual(overridden?.layer, 'app');
  });

  it('combines the middleware of every layer, ordered by name', async () => {
    const middleware = await collectMiddleware([dep, app]);
    deepStrictEqual(
      middleware.map((entry) => entry.name),
      ['10-auth', '20-locale'],
    );
  });
});

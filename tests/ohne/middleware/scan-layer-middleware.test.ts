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
      middleware.map((entry) => ({
        name: entry.name,
        isGlobal: entry.isGlobal,
        layer: entry.layer,
      })),
      [
        { name: '10-auth', isGlobal: false, layer: 'dep' },
        { name: 'admin-guard', isGlobal: false, layer: 'dep' },
      ],
    );
  });

  it('skips underscore-prefixed helper files and directories', async () => {
    const helper: OhneLayer = { name: 'helper', dir: join(root, 'helper') };
    writeMiddleware(helper.dir, 'auth.ts');
    writeMiddleware(helper.dir, '_shared.ts');
    writeMiddleware(helper.dir, '_lib/util.ts');
    const middleware = await scanLayerMiddleware(helper, 'middleware');
    deepStrictEqual(
      middleware.map((entry) => entry.name),
      ['auth'],
    );
  });

  it('flags files under global/ as global, leaving a literal global.ts named', async () => {
    const layer: OhneLayer = { name: 'g', dir: join(root, 'g') };
    writeMiddleware(layer.dir, 'global/session.ts');
    writeMiddleware(layer.dir, 'global.ts');
    const byName = new Map(
      (await scanLayerMiddleware(layer, 'middleware')).map((entry) => [entry.name, entry.isGlobal]),
    );
    deepStrictEqual(byName.get('global-session'), true);
    deepStrictEqual(byName.get('global'), false);
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

  it('throws when a global file and a named file resolve to the same name', async () => {
    const clashing: OhneLayer = { name: 'gclash', dir: join(root, 'gclash') };
    writeMiddleware(clashing.dir, 'global/auth.ts');
    writeMiddleware(clashing.dir, 'global-auth.ts');
    await rejects(
      scanLayerMiddleware(clashing, 'middleware'),
      /Duplicate middleware `global-auth`/,
    );
  });

  it('throws when a filename holds a character its generated import cannot resolve', async () => {
    const layer: OhneLayer = { name: 'bad', dir: join(root, 'bad') };
    writeMiddleware(layer.dir, 'a#b.ts');
    await rejects(
      scanLayerMiddleware(layer, 'middleware'),
      /Unsupported character `#` in a middleware path/,
    );
  });
});

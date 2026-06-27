import { deepStrictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { resolveLayerDir } from '../../../src/ohne/index.ts';

describe('resolveLayerDir', { skip: process.platform === 'win32' }, () => {
  let root: string;
  let app: string;
  let kit: string;

  function writePackage(name: string, exports: unknown): string {
    const dir = join(app, 'node_modules', name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, exports }));
    return realpathSync(dir);
  }

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'ohne-resolve-layer-dir-'));
    app = join(root, 'app');
    mkdirSync(app, { recursive: true });

    kit = writePackage('@acme/kit', { './auth': './auth/ohne.config.ts' });
    writePackage('@acme/wild', { './*': './*/ohne.config.ts' });
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('resolves a bare package name to its root', async () => {
    deepStrictEqual(await resolveLayerDir('@acme/kit', app), kit);
  });

  it('resolves an exact exports subpath to its config directory', async () => {
    deepStrictEqual(await resolveLayerDir('@acme/kit/auth', app), join(kit, 'auth'));
  });

  it('resolves a subpath through an exports wildcard', async () => {
    const wild = realpathSync(join(app, 'node_modules/@acme/wild'));
    deepStrictEqual(await resolveLayerDir('@acme/wild/blog', app), join(wild, 'blog'));
  });

  it('returns null when the package is not installed', async () => {
    deepStrictEqual(await resolveLayerDir('@acme/missing', app), null);
  });

  it('returns null when the subpath is not exported', async () => {
    deepStrictEqual(await resolveLayerDir('@acme/kit/ghost', app), null);
  });
});

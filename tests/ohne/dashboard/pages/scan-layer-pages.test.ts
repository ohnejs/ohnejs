import { deepStrictEqual, rejects } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { type OhneLayer, scanLayerDashboardPages } from '../../../../src/ohne/index.ts';

describe('scanLayerDashboardPages', () => {
  let root: string;
  let app: OhneLayer;

  function writePage(layerDir: string, relative: string): void {
    const file = join(layerDir, 'dashboard', 'pages', relative);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, 'export default () => null\n');
  }

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'ohne-scan-layer-dashboard-pages-'));
    app = { name: 'app', dir: join(root, 'app') };
    writePage(app.dir, 'index.ts');
    writePage(app.dir, 'users/[id].ts');
    writePage(app.dir, 'files/[...path].ts');
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('maps each file to a pattern and module', async () => {
    const pages = await scanLayerDashboardPages(app, 'dashboard');
    deepStrictEqual(
      pages.map((page) => ({ pattern: page.pattern, module: page.module, layer: page.layer })),
      [
        { pattern: '/files/[...path]', module: 'pages/files/[...path].ts', layer: 'app' },
        { pattern: '/', module: 'pages/index.ts', layer: 'app' },
        { pattern: '/users/[id]', module: 'pages/users/[id].ts', layer: 'app' },
      ],
    );
  });

  it('returns an empty list when a layer has no pages directory', async () => {
    deepStrictEqual(
      await scanLayerDashboardPages({ name: 'bare', dir: join(root, 'bare') }, 'dashboard'),
      [],
    );
  });

  it('throws when two files resolve to the same page', async () => {
    const clash: OhneLayer = { name: 'clash', dir: join(root, 'clash') };
    writePage(clash.dir, 'users.ts');
    writePage(clash.dir, 'users/index.ts');
    await rejects(scanLayerDashboardPages(clash, 'dashboard'), /Duplicate page/);
  });
});

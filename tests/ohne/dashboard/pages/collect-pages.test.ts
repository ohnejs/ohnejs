import { deepStrictEqual, strictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { collectDashboardPages, type OhneLayer } from '../../../../src/ohne/index.ts';

describe('collectDashboardPages', () => {
  let root: string;
  let dep: OhneLayer;
  let app: OhneLayer;

  function writePage(layerDir: string, relative: string): void {
    const file = join(layerDir, 'dashboard', 'pages', relative);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, 'export default () => null\n');
  }

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'ohne-collect-dashboard-pages-'));
    dep = { name: 'dep', dir: join(root, 'dep') };
    app = { name: 'app', dir: join(root, 'app') };
    writePage(dep.dir, 'index.ts');
    writePage(dep.dir, 'users/[id].ts');
    writePage(app.dir, 'users/[id].ts');
    writePage(app.dir, 'about.ts');
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('lets a closer layer override an earlier page', async () => {
    const pages = await collectDashboardPages([dep, app]);
    strictEqual(pages.find((page) => page.pattern === '/users/[id]')?.layer, 'app');
  });

  it('combines the pages of every layer, sorted by pattern', async () => {
    const pages = await collectDashboardPages([dep, app]);
    deepStrictEqual(
      pages.map((page) => page.pattern),
      ['/', '/about', '/users/[id]'],
    );
  });
});

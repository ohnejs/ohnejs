import { deepStrictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { collectDashboardBoot, type OhneLayer } from '../../../src/ohne/index.ts';

describe('collectDashboardBoot', () => {
  let root: string;
  let dep: OhneLayer;
  let app: OhneLayer;

  function writeBoot(layerDir: string, relative: string): void {
    const file = join(layerDir, 'dashboard', 'boot', relative);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, 'export default null\n');
  }

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'ohne-collect-dashboard-boot-'));
    dep = { name: 'dep', dir: join(root, 'dep') };
    app = { name: 'app', dir: join(root, 'app') };
    writeBoot(dep.dir, 'slots.ts');
    writeBoot(dep.dir, 'fields.ts');
    writeBoot(app.dir, 'theme.ts');
    writeBoot(app.dir, 'fields.ts');
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('runs the furthest layer first and lists a shared path once, where it first appears', async () => {
    const boot = await collectDashboardBoot([dep, app]);
    deepStrictEqual(
      boot.map((file) => file.module),
      ['boot/fields.ts', 'boot/slots.ts', 'boot/theme.ts'],
    );
  });

  it('lets the closer layer own a shared path', async () => {
    const boot = await collectDashboardBoot([dep, app]);
    deepStrictEqual(
      boot.map((file) => file.layer),
      ['app', 'dep', 'app'],
    );
  });
});

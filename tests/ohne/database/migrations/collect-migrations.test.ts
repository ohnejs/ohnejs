import { deepStrictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';

import { collectMigrations, loadLayers, useLayers } from '../../../../src/ohne/index.ts';
import { stackedLayers } from '../../../../src/ohne/layers/stacked-layers.ts';

describe('collectMigrations', () => {
  let root: string;

  function writePackage(at: string, name: string, config: string, layers?: string[]): void {
    mkdirSync(at, { recursive: true });
    const dependencies = Object.fromEntries((layers ?? []).map((layer) => [layer, '*']));
    writeFileSync(join(at, 'package.json'), JSON.stringify({ name, type: 'module', dependencies }));
    writeFileSync(join(at, 'ohne.config.ts'), config);
  }

  function writeMigration(dir: string, relative: string): void {
    const file = join(dir, relative);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, 'export default { from: { table: "Posts" }, to: null };\n');
  }

  before(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'ohne-collect-migrations-')));
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  afterEach(() => {
    useLayers().clear();
  });

  it('combines layers furthest-first, each read from its own migrations dir', async () => {
    const app = join(root, 'app');
    writePackage(app, 'app', "export default { layers: ['dep'], dirs: { migrations: 'db' } };\n", [
      'dep',
    ]);
    const dep = join(app, 'packages', 'dep');
    writePackage(dep, 'dep', 'export default {};\n');
    mkdirSync(join(app, 'node_modules'), { recursive: true });
    symlinkSync(dep, join(app, 'node_modules', 'dep'), 'dir');

    writeMigration(dep, 'migrations/001-keys.ts');
    writeMigration(app, 'db/001-posts.ts');
    writeMigration(app, 'db/002-drafts.ts');

    await loadLayers(app);
    const collected = await collectMigrations(stackedLayers());
    deepStrictEqual(
      collected.map((migration) => migration.name),
      ['dep/001-keys', 'app/001-posts', 'app/002-drafts'],
    );
  });
});

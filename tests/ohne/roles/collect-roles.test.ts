import { deepStrictEqual, rejects } from 'node:assert';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';

import { collectRoles, loadLayers, useLayers } from '../../../src/ohne/index.ts';
import { stackedLayers } from '../../../src/ohne/layers/stacked-layers.ts';

describe('collectRoles', () => {
  let root: string;

  function writePackage(at: string, name: string, config: string, layers?: string[]): void {
    mkdirSync(at, { recursive: true });
    const dependencies = Object.fromEntries((layers ?? []).map((layer) => [layer, '*']));
    writeFileSync(join(at, 'package.json'), JSON.stringify({ name, type: 'module', dependencies }));
    writeFileSync(join(at, 'ohne.config.ts'), config);
  }

  function writeRole(dir: string, relative: string, capabilities: string[]): void {
    const file = join(dir, 'roles', relative);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, `export default { capabilities: ${JSON.stringify(capabilities)} };\n`);
  }

  async function appWith(name: string, write: (app: string, dep: string) => void): Promise<string> {
    const app = join(root, name);
    writePackage(app, name, "export default { layers: ['dep'] };\n", ['dep']);
    const dep = join(app, 'packages', 'dep');
    writePackage(dep, 'dep', 'export default {};\n');
    mkdirSync(join(app, 'node_modules'), { recursive: true });
    symlinkSync(dep, join(app, 'node_modules', 'dep'), 'dir');
    write(app, dep);
    await loadLayers(app);
    return app;
  }

  before(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'ohne-collect-roles-')));
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  afterEach(() => {
    useLayers().clear();
  });

  it('imports each definition, a closer layer replacing a further one by name', async () => {
    await appWith('override', (app, dep) => {
      writeRole(dep, 'admin.ts', ['*']);
      writeRole(dep, 'editor.ts', ['collection.Posts.read']);
      writeRole(app, 'editor.ts', ['collection.Posts.*']);
    });
    const collected = await collectRoles(stackedLayers());
    deepStrictEqual(
      collected.map((role) => role.name),
      ['admin', 'editor'],
    );
    deepStrictEqual(collected[1]?.role.capabilities, ['collection.Posts.*']);
  });

  it('drops disabled names after the merge', async () => {
    await appWith('disabled', (app) => {
      writeRole(app, 'admin.ts', ['*']);
      writeRole(app, 'editor.ts', ['collection.Posts.read']);
    });
    const collected = await collectRoles(stackedLayers(), { disable: ['admin'] });
    deepStrictEqual(
      collected.map((role) => role.name),
      ['editor'],
    );
  });

  it('rejects a file without a definition default export', async () => {
    await appWith('empty', (app) => {
      const file = join(app, 'roles', 'editor.ts');
      mkdirSync(join(file, '..'), { recursive: true });
      writeFileSync(file, 'export const editor = 1;\n');
    });
    await rejects(collectRoles(stackedLayers()), /`editor` has no definition/);
  });
});

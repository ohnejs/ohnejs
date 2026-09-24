import { strictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';

import { appRoot, loadLayers, useLayers } from '../../../src/ohne/index.ts';

describe('appRoot', () => {
  const cwd = process.cwd();
  let root: string;

  function writePackage(at: string, name: string, config: string, layers?: string[]): void {
    mkdirSync(at, { recursive: true });
    const dependencies = Object.fromEntries((layers ?? []).map((layer) => [layer, '*']));
    writeFileSync(join(at, 'package.json'), JSON.stringify({ name, type: 'module', dependencies }));
    writeFileSync(join(at, 'ohne.config.ts'), config);
  }

  before(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'ohne-app-root-')));
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  afterEach(() => {
    process.chdir(cwd);
    useLayers().clear();
  });

  it('returns the process working directory before a stack loads', () => {
    process.chdir(root);
    strictEqual(appRoot(), root);
  });

  it("returns the closest layer's directory once a stack loads", async () => {
    const app = join(root, 'app');
    writePackage(app, 'app', "export default { layers: ['dep'] };\n", ['dep']);
    const dep = join(app, 'packages', 'dep');
    writePackage(dep, 'dep', 'export default {};\n');
    mkdirSync(join(app, 'node_modules'), { recursive: true });
    symlinkSync(dep, join(app, 'node_modules', 'dep'), 'dir');
    await loadLayers(app);
    strictEqual(appRoot(), app);
  });
});

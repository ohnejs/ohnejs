import { deepStrictEqual, rejects } from 'node:assert';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';

import { collectLayerFiles, isOhneError, loadLayers, useLayers } from '../../../src/ohne/index.ts';
import { stackedLayers } from '../../../src/ohne/layers/stacked-layers.ts';
import { isPlainObject, isString } from '../../../src/utils/index.ts';

/**
 * Whether a default export carries a string `id`.
 */
function hasId(definition: unknown): definition is { id: string } {
  return isPlainObject(definition) && isString(definition.id);
}

describe('collectLayerFiles', () => {
  let root: string;

  function writePackage(at: string, name: string, config: string, layers?: string[]): void {
    mkdirSync(at, { recursive: true });
    const dependencies = Object.fromEntries((layers ?? []).map((layer) => [layer, '*']));
    writeFileSync(join(at, 'package.json'), JSON.stringify({ name, type: 'module', dependencies }));
    writeFileSync(join(at, 'ohne.config.ts'), config);
  }

  function writeFile(dir: string, relative: string, id: string): void {
    const file = join(dir, relative);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, `export default { id: ${JSON.stringify(id)} };\n`);
  }

  async function appWith(
    name: string,
    config: string,
    write: (app: string, dep: string) => void,
  ): Promise<void> {
    const app = join(root, name);
    writePackage(app, name, config, ['dep']);
    const dep = join(app, 'packages', 'dep');
    writePackage(dep, 'dep', 'export default {};\n');
    mkdirSync(join(app, 'node_modules'), { recursive: true });
    symlinkSync(dep, join(app, 'node_modules', 'dep'), 'dir');
    write(app, dep);
    await loadLayers(app);
  }

  before(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'ohne-collect-layer-files-')));
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  afterEach(() => {
    useLayers().clear();
  });

  it('keys each definition by its kind, closest layer first, sorted by name', async () => {
    await appWith('merge', "export default { layers: ['dep'] };\n", (app, dep) => {
      writeFile(dep, 'flows/b.ts', 'dep-b');
      writeFile(dep, 'flows/a10.ts', 'dep-a10');
      writeFile(app, 'flows/b.ts', 'app-b');
      writeFile(app, 'flows/a2.ts', 'app-a2');
    });
    const collected = await collectLayerFiles('flow', stackedLayers(), hasId);
    deepStrictEqual(
      collected.map((entry) => [entry.name, entry.flow.id]),
      [
        ['a2', 'app-a2'],
        ['a10', 'dep-a10'],
        ['b', 'app-b'],
      ],
    );
  });

  it('reads the `dirs` entry named by the kind and drops disabled names', async () => {
    const config = "export default { layers: ['dep'], dirs: { roles: 'people' } };\n";
    await appWith('dirs', config, (app) => {
      writeFile(app, 'people/editor.ts', 'editor');
      writeFile(app, 'people/admin.ts', 'admin');
      writeFile(app, 'roles/ignored.ts', 'ignored');
    });
    const collected = await collectLayerFiles('role', stackedLayers(), hasId, {
      disable: ['admin'],
    });
    deepStrictEqual(
      collected.map((entry) => entry.name),
      ['editor'],
    );
  });

  it('rejects a default export the guard refuses, naming the kind and its define call', async () => {
    await appWith('bad', "export default { layers: ['dep'] };\n", (app) => {
      mkdirSync(join(app, 'skills'), { recursive: true });
      writeFileSync(join(app, 'skills', 'x.ts'), 'export const x = 1;\n');
    });
    await rejects(
      collectLayerFiles('skill', stackedLayers(), hasId),
      (error) =>
        isOhneError(error) &&
        error.message === 'Skill `x` has no definition' &&
        String(error.body) === 'Default-export a `defineSkill(...)` result from the file.',
    );
  });
});

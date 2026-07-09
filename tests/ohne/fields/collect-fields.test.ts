import { deepStrictEqual, rejects, strictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';

import { collectFields, loadLayers, useLayers } from '../../../src/ohne/index.ts';
import { stackedLayers } from '../../../src/ohne/layers/stacked-layers.ts';

describe('collectFields', () => {
  let root: string;

  function writePackage(at: string, name: string, config: string, layers?: string[]): void {
    mkdirSync(at, { recursive: true });
    const dependencies = Object.fromEntries((layers ?? []).map((layer) => [layer, '*']));
    writeFileSync(join(at, 'package.json'), JSON.stringify({ name, type: 'module', dependencies }));
    writeFileSync(join(at, 'ohne.config.ts'), config);
  }

  function writeFieldType(dir: string, relative: string, columnType = 'text'): void {
    const file = join(dir, relative);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, `export default { columnType: '${columnType}' };\n`);
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
    root = realpathSync(mkdtempSync(join(tmpdir(), 'ohne-collect-fields-')));
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  afterEach(() => {
    useLayers().clear();
  });

  it('imports each definition, a closer layer replacing a further one by name', async () => {
    await appWith('override', (app, dep) => {
      writeFieldType(dep, 'fields/slug.ts', 'text');
      writeFieldType(dep, 'fields/money.ts', 'integer');
      writeFieldType(app, 'fields/slug.ts', 'json');
    });
    const collected = await collectFields(stackedLayers());
    deepStrictEqual(
      collected.map((fieldType) => fieldType.name),
      ['money', 'slug'],
    );
    strictEqual(collected[1]?.fieldType.columnType, 'json');
  });

  it('drops disabled names after the merge', async () => {
    await appWith('disabled', (app) => {
      writeFieldType(app, 'fields/slug.ts');
      writeFieldType(app, 'fields/money.ts');
    });
    const collected = await collectFields(stackedLayers(), { disable: ['slug'] });
    deepStrictEqual(
      collected.map((fieldType) => fieldType.name),
      ['money'],
    );
  });

  it('rejects a file without a definition default export', async () => {
    await appWith('empty', (app) => {
      const file = join(app, 'fields', 'slug.ts');
      mkdirSync(join(file, '..'), { recursive: true });
      writeFileSync(file, 'export const slug = 1;\n');
    });
    await rejects(collectFields(stackedLayers()), /`slug` has no definition/);
  });
});

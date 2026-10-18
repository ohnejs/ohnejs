import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';

import { collectFields, loadLayers, useLayers } from '../../../src/ohne/index.ts';
import { stackedLayers } from '../../../src/ohne/layers/stacked-layers.ts';

const SRC = pathToFileURL(
  join(import.meta.dirname, '..', '..', '..', 'src', 'ohne', 'index.ts'),
).href;

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
      writeFieldType(dep, 'fields/sku.ts', 'text');
      writeFieldType(dep, 'fields/money.ts', 'integer');
      writeFieldType(app, 'fields/sku.ts', 'json');
    });
    const collected = await collectFields(stackedLayers());
    deepStrictEqual(
      collected.map((fieldType) => fieldType.name),
      ['money', 'sku'],
    );
    strictEqual(collected[1]?.fieldType.columnType, 'json');
  });

  it('drops disabled names after the merge', async () => {
    await appWith('disabled', (app) => {
      writeFieldType(app, 'fields/sku.ts');
      writeFieldType(app, 'fields/money.ts');
    });
    const collected = await collectFields(stackedLayers(), { disable: ['sku'] });
    deepStrictEqual(
      collected.map((fieldType) => fieldType.name),
      ['money'],
    );
  });

  it('rejects a file without a definition default export', async () => {
    await appWith('empty', (app) => {
      const file = join(app, 'fields', 'sku.ts');
      mkdirSync(join(file, '..'), { recursive: true });
      writeFileSync(file, 'export const sku = 1;\n');
    });
    await rejects(collectFields(stackedLayers()), /`sku` has no definition/);
  });

  it('names the file of a field type whose definition throws on import', async () => {
    const app = await appWith('located', (app) => {
      const file = join(app, 'fields/ghost.ts');
      mkdirSync(join(file, '..'), { recursive: true });
      writeFileSync(
        file,
        `import { defineField } from '${SRC}';\n` +
          'export default defineField({ columnType: false, forceNullable: true });\n',
      );
    });
    const error = await collectFields(stackedLayers()).catch((error: unknown) => error);
    ok(error instanceof Error);
    strictEqual((error as { path?: string }).path, join(app, 'fields/ghost.ts'));
  });
});

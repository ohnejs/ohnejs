import { strictEqual } from 'node:assert';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';

import { BANNER } from '../../../src/ohne/codegen/codegen-dir.ts';
import { generateLayerName, loadLayers, useLayers } from '../../../src/ohne/index.ts';

interface LayerSpec {
  name: string;
  ohne?: boolean;
  augments?: boolean;
  deps?: string[];
  layers?: string[];
  codegen?: string;
}

describe('generateLayerName', { skip: process.platform === 'win32' }, () => {
  let root: string;

  function writeManifest(dir: string, spec: LayerSpec): void {
    mkdirSync(dir, { recursive: true });
    const dependencies = Object.fromEntries((spec.deps ?? []).map((dep) => [dep, '*']));
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: spec.name, type: 'module', dependencies }),
    );
    if (spec.ohne !== false) writeConfig(dir, spec);
    if (spec.augments) {
      writeFileSync(
        join(dir, 'augments.ts'),
        "import type {} from 'ohnejs';\ndeclare module 'ohnejs' {}\n",
      );
    }
  }

  function writeConfig(dir: string, spec: Omit<LayerSpec, 'name'>): void {
    const config = {
      layers: spec.layers,
      dirs: spec.codegen ? { codegen: spec.codegen } : undefined,
    };
    writeFileSync(join(dir, 'ohne.config.ts'), `export default ${JSON.stringify(config)}\n`);
  }

  function link(store: string, consumer: string, name: string): void {
    const modules = join(consumer, 'node_modules');
    mkdirSync(modules, { recursive: true });
    symlinkSync(join(store, name), join(modules, name), 'dir');
  }

  function scaffold(id: string, app: Omit<LayerSpec, 'name'>, layers: LayerSpec[]): string {
    const store = join(root, id, 'store');
    const dir = join(root, id, 'app');
    for (const spec of layers) writeManifest(join(store, spec.name), spec);
    writeManifest(dir, { ...app, name: id });
    for (const dep of app.deps ?? []) link(store, dir, dep);
    return dir;
  }

  before(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'ohne-gen-layer-')));
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  afterEach(() => {
    useLayers().clear();
  });

  it("imports each stacked layer's augmentation files, skipping unstacked and non-augmenting", async () => {
    const app = scaffold('app1', { deps: ['a', 'b', 'c'], layers: ['a', 'b'] }, [
      { name: 'a', augments: true },
      { name: 'b' },
      { name: 'c', augments: true },
    ]);

    await loadLayers(app);
    const path = await generateLayerName(app);
    strictEqual(path?.endsWith('/.ohne/node/layer-name.ts'), true);
    strictEqual(
      readFileSync(path!, 'utf8'),
      `${BANNER}\n` +
        "import type {} from '../../../store/a/augments.ts';\n" +
        '\n' +
        "declare module 'ohnejs' {\n" +
        '  interface KnownLayers {\n' +
        "    'a': true;\n" +
        "    'b': true;\n" +
        "    'c': true;\n" +
        '  }\n' +
        '}\n',
    );
  });

  it('falls back to importing ohne when no stacked layer augments', async () => {
    const app = scaffold('app2', { deps: ['a'], layers: ['a'] }, [{ name: 'a' }]);

    await loadLayers(app);
    const path = await generateLayerName(app);
    strictEqual(
      readFileSync(path!, 'utf8'),
      `${BANNER}\n` +
        "import type {} from 'ohnejs';\n" +
        '\n' +
        "declare module 'ohnejs' {\n" +
        '  interface KnownLayers {\n' +
        "    'a': true;\n" +
        '  }\n' +
        '}\n',
    );
  });

  it('emits an empty interface when the closure has no ohne layers', async () => {
    const app = scaffold('app3', { deps: ['plain'] }, [{ name: 'plain', ohne: false }]);

    await loadLayers(app);
    const path = await generateLayerName(app);
    strictEqual(
      readFileSync(path!, 'utf8'),
      `${BANNER}\n` +
        "import type {} from 'ohnejs';\n" +
        '\n' +
        "declare module 'ohnejs' {\n" +
        '  interface KnownLayers {}\n' +
        '}\n',
    );
  });

  it('honors Config.dirs.codegen for the output directory', async () => {
    const app = scaffold('app4', { deps: ['a'], layers: ['a'], codegen: 'generated' }, [
      { name: 'a', augments: true },
    ]);

    await loadLayers(app);
    const path = await generateLayerName(app);
    strictEqual(path?.endsWith('/generated/node/layer-name.ts'), true);
    strictEqual(
      readFileSync(path!, 'utf8'),
      `${BANNER}\n` +
        "import type {} from '../../../store/a/augments.ts';\n" +
        '\n' +
        "declare module 'ohnejs' {\n" +
        '  interface KnownLayers {\n' +
        "    'a': true;\n" +
        '  }\n' +
        '}\n',
    );
  });

  it('follows the registered stack after a fresh reload', async () => {
    const app = scaffold('app5', { deps: ['a', 'b'], layers: ['a'] }, [
      { name: 'a', augments: true },
      { name: 'b', augments: true },
    ]);
    await loadLayers(app);
    await generateLayerName(app);

    writeConfig(app, { layers: ['b'] });
    await loadLayers(app, { fresh: true });
    const path = await generateLayerName(app);
    strictEqual(
      readFileSync(path!, 'utf8').split('\n')[1],
      "import type {} from '../../../store/b/augments.ts';",
    );
  });

  it('returns null when no package.json is found', async () => {
    strictEqual(await generateLayerName(join(root, 'nowhere')), null);
  });
});

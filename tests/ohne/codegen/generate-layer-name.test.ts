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
import { after, before, describe, it } from 'node:test';

import { BANNER } from '../../../src/ohne/codegen/codegen-dir.ts';
import { generateLayerName, useLayers } from '../../../src/ohne/index.ts';

interface LayerSpec {
  name: string;
  ohne?: boolean;
  augments?: boolean;
  deps?: string[];
  layers?: string[];
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
    if (spec.ohne !== false) {
      const config = spec.layers ? { layers: spec.layers } : {};
      writeFileSync(join(dir, 'ohne.config.ts'), `export default ${JSON.stringify(config)}\n`);
    }
    if (spec.augments) {
      writeFileSync(
        join(dir, 'augments.ts'),
        "import type {} from 'ohnejs';\ndeclare module 'ohnejs' {}\n",
      );
    }
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

  it("imports each stacked layer's augmentation files, skipping unstacked and non-augmenting", async () => {
    const app = scaffold('app1', { deps: ['a', 'b', 'c'], layers: ['a', 'b'] }, [
      { name: 'a', augments: true },
      { name: 'b' },
      { name: 'c', augments: true },
    ]);

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
    const app = scaffold('app4', { deps: ['a'], layers: ['a'] }, [{ name: 'a', augments: true }]);

    const layers = useLayers();
    layers.add({ path: app, input: { dirs: { codegen: 'generated' } } });
    try {
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
    } finally {
      layers.remove(app);
    }
  });

  it('returns null when no package.json is found', async () => {
    strictEqual(await generateLayerName(join(root, 'nowhere')), null);
  });
});

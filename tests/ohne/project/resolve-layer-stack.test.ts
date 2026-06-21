import { deepStrictEqual, rejects } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { resolveLayerStack } from '../../../src/ohne/index.ts';

interface LayerSpec {
  name: string;
  deps?: string[];
  layers?: string[];
}

describe('resolveLayerStack', () => {
  let root: string;
  let store: string;
  let app: string;

  // Layers live in a store outside node_modules and are symlinked into each consumer, as pnpm does.
  // `resolveModuleDir` realpaths the symlink, so configs import from the store - Node refuses to
  // strip types under node_modules.
  function writeManifest(dir: string, spec: LayerSpec): void {
    const dependencies = Object.fromEntries((spec.deps ?? []).map((dep) => [dep, '*']));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: spec.name, dependencies }));
    const config = spec.layers ? { layers: spec.layers } : {};
    writeFileSync(join(dir, 'ohne.config.ts'), `export default ${JSON.stringify(config)}\n`);
  }

  function writeLayer(spec: LayerSpec): void {
    const dir = join(store, spec.name);
    mkdirSync(dir, { recursive: true });
    writeManifest(dir, spec);
    for (const dep of spec.deps ?? []) link(dir, dep);
  }

  function link(consumer: string, name: string): void {
    const modules = join(consumer, 'node_modules');
    mkdirSync(modules, { recursive: true });
    symlinkSync(join(store, name), join(modules, name), 'dir');
  }

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'ohne-resolve-layer-stack-'));
    store = join(root, 'store');
    app = join(root, 'app');
    mkdirSync(app, { recursive: true });

    // Diamond: app extends a and b, both extend c. d is installed but never listed.
    writeLayer({ name: 'a', deps: ['c'], layers: ['c'] });
    writeLayer({ name: 'b', deps: ['c'], layers: ['c'] });
    writeLayer({ name: 'c' });
    writeLayer({ name: 'd' });
    writeManifest(app, { name: 'app', deps: ['a', 'b', 'd'], layers: ['a', 'b'] });
    for (const dep of ['a', 'b', 'd']) link(app, dep);
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('emits a shared layer once, ahead of every entry that lists it, app last', async () => {
    const stack = await resolveLayerStack(app);
    deepStrictEqual(
      stack.map((layer) => layer.name),
      ['c', 'a', 'b', 'app'],
    );
  });

  it('leaves out an installed layer no one lists', async () => {
    const stack = await resolveLayerStack(app);
    deepStrictEqual(
      stack.some((layer) => layer.name === 'd'),
      false,
    );
  });

  it('pairs each layer with its own input config', async () => {
    const stack = await resolveLayerStack(app);
    const byName = Object.fromEntries(stack.map((layer) => [layer.name, layer.input]));
    deepStrictEqual(byName.a, { layers: ['c'] });
    deepStrictEqual(byName.c, {});
  });

  it('throws when a listed layer has no ohne.config.ts', async () => {
    const broken = join(root, 'broken');
    mkdirSync(broken, { recursive: true });
    writeManifest(broken, { name: 'broken', deps: ['plain'], layers: ['plain'] });
    mkdirSync(join(store, 'plain'), { recursive: true });
    writeFileSync(join(store, 'plain', 'package.json'), JSON.stringify({ name: 'plain' }));
    link(broken, 'plain');

    await rejects(
      () => resolveLayerStack(broken),
      /Layer "plain" listed by "broken" cannot be used/,
    );
  });

  it('returns an empty list when no package.json is found', async () => {
    deepStrictEqual(await resolveLayerStack(join(root, 'nowhere')), []);
  });
});

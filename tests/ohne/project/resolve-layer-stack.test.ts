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
  exports?: unknown;
}

describe('resolveLayerStack', { skip: process.platform === 'win32' }, () => {
  let root: string;
  let store: string;
  let app: string;

  // Layers live in a store outside node_modules and are symlinked into each consumer, as pnpm does.
  // `resolveModuleDir` realpaths the symlink, so configs import from the store - Node refuses to
  // strip types under node_modules.
  function writeManifest(dir: string, spec: LayerSpec): void {
    const dependencies = Object.fromEntries((spec.deps ?? []).map((dep) => [dep, '*']));
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: spec.name, type: 'module', dependencies, exports: spec.exports }),
    );
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

    await rejects(() => resolveLayerStack(broken), /Layer `plain` cannot be used/);
  });

  it('returns an empty list when no package.json is found', async () => {
    deepStrictEqual(await resolveLayerStack(join(root, 'nowhere')), []);
  });

  it('resolves a layer named by an exported package subpath', async () => {
    const consumer = join(root, 'subpath-app');
    mkdirSync(consumer, { recursive: true });
    writeManifest(consumer, { name: 'subpath-app', deps: ['kit'], layers: ['kit/auth'] });

    const kit = join(store, 'kit');
    mkdirSync(join(kit, 'auth'), { recursive: true });
    writeFileSync(
      join(kit, 'package.json'),
      JSON.stringify({
        name: 'kit',
        type: 'module',
        exports: { './auth': './auth/ohne.config.ts' },
      }),
    );
    writeFileSync(join(kit, 'auth', 'ohne.config.ts'), 'export default {}\n');
    link(consumer, 'kit');

    const stack = await resolveLayerStack(consumer);
    deepStrictEqual(
      stack.map((layer) => layer.name),
      ['kit/auth', 'subpath-app'],
    );
  });

  it('throws when a listed subpath is not exported', async () => {
    const consumer = join(root, 'bad-subpath');
    mkdirSync(consumer, { recursive: true });
    writeManifest(consumer, { name: 'bad-subpath', deps: ['kit2'], layers: ['kit2/ghost'] });

    const kit = join(store, 'kit2');
    mkdirSync(kit, { recursive: true });
    writeFileSync(join(kit, 'package.json'), JSON.stringify({ name: 'kit2', exports: {} }));
    link(consumer, 'kit2');

    await rejects(() => resolveLayerStack(consumer), /Layer `kit2\/ghost` cannot be used/);
  });

  it('resolves a subpath of the app itself through its own exports, once', async () => {
    const consumer = join(root, 'self-app');
    const uploads = join(consumer, 'uploads');
    mkdirSync(uploads, { recursive: true });
    writeManifest(consumer, {
      name: 'self-app',
      layers: ['self-app/uploads'],
      exports: {
        './uploads': { types: './uploads/ohne.config.ts', default: './uploads/ohne.config.ts' },
      },
    });
    writeFileSync(
      join(uploads, 'ohne.config.ts'),
      `export default ${JSON.stringify({ layers: ['self-app'] })}\n`,
    );

    const stack = await resolveLayerStack(consumer);
    deepStrictEqual(
      stack.map((layer) => layer.name),
      ['self-app/uploads', 'self-app'],
    );
    deepStrictEqual(stack[0].dir, uploads);
  });

  it('throws when the app lists a subpath it does not export', async () => {
    const consumer = join(root, 'self-ghost');
    mkdirSync(consumer, { recursive: true });
    writeManifest(consumer, { name: 'self-ghost', layers: ['self-ghost/ghost'], exports: {} });

    await rejects(() => resolveLayerStack(consumer), /Layer `self-ghost\/ghost` cannot be used/);
  });
});

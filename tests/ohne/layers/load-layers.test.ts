import { deepStrictEqual, rejects } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { loadLayers, useConfig } from '../../../src/ohne/index.ts';

describe('loadLayers', { skip: process.platform === 'win32' }, () => {
  let root: string;
  let store: string;
  let app: string;

  function writeManifest(dir: string, name: string, deps: string[], config: object): void {
    const dependencies = Object.fromEntries(deps.map((dep) => [dep, '*']));
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name, type: 'module', dependencies }),
    );
    writeFileSync(join(dir, 'ohne.config.ts'), `export default ${JSON.stringify(config)}\n`);
  }

  function link(consumer: string, name: string): void {
    const modules = join(consumer, 'node_modules');
    mkdirSync(modules, { recursive: true });
    symlinkSync(join(store, name), join(modules, name), 'dir');
  }

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'ohne-load-layers-'));
    store = join(root, 'store');
    app = join(root, 'app');
    mkdirSync(join(store, 'base'), { recursive: true });
    mkdirSync(app, { recursive: true });

    writeManifest(join(store, 'base'), 'base', [], {
      dirs: { api: 'routes' },
      printer: { debug: true },
    });
    writeManifest(app, 'app', ['base'], {
      layers: ['base'],
      dirs: { codegen: 'gen' },
      printer: { silent: true },
    });
    link(app, 'base');
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('registers the stack so useConfig returns the merged config', async () => {
    const stack = await loadLayers(app);
    deepStrictEqual(
      stack.map((layer) => layer.name),
      ['base', 'app'],
    );
    deepStrictEqual(useConfig().dirs, { codegen: 'gen' });
    deepStrictEqual(useConfig().printer, { silent: true });
  });

  it('reloads in place, replacing the previous stack', async () => {
    const reload = join(root, 'reload');
    mkdirSync(reload, { recursive: true });
    writeManifest(reload, 'reload', [], { dirs: { codegen: 'gen' } });

    await loadLayers(reload);
    deepStrictEqual(useConfig().dirs, { codegen: 'gen' });

    writeFileSync(join(reload, 'ohne.config.ts'), "export default { dirs: { codegen: 'out' } }\n");
    const stack = await loadLayers(reload, { fresh: true });
    deepStrictEqual(
      stack.map((layer) => layer.name),
      ['reload'],
    );
    deepStrictEqual(useConfig().dirs, { codegen: 'out' });
  });

  it('leaves the previous stack intact when a reload fails to import', async () => {
    const broken = join(root, 'broken');
    mkdirSync(broken, { recursive: true });
    writeManifest(broken, 'broken', [], { dirs: { codegen: 'gen' } });

    await loadLayers(broken);
    writeFileSync(join(broken, 'ohne.config.ts'), 'export default {\n');

    await rejects(loadLayers(broken, { fresh: true }));
    deepStrictEqual(useConfig().dirs, { codegen: 'gen' });
  });
});

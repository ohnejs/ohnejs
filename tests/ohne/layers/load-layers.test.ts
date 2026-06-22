import { deepStrictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { loadLayers, useConfig } from '../../../src/ohne/index.ts';

describe('loadLayers', () => {
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
});

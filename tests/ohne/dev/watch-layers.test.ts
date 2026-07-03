import { ok } from 'node:assert';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { watchLayers, type LayerWatch } from '../../../src/ohne/dev/watch-layers.ts';
import { loadLayers, useLayers } from '../../../src/ohne/index.ts';

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await delay(15);
  }
}

const skipOnWindows = { skip: process.platform === 'win32' };

describe('watchLayers', () => {
  let root: string;
  let watch: LayerWatch | undefined;
  let changed: string[];

  function manifest(dir: string, name: string, deps: string[], config: object): void {
    mkdirSync(join(dir, 'api'), { recursive: true });
    const dependencies = Object.fromEntries(deps.map((dep) => [dep, '*']));
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name, type: 'module', dependencies }),
    );
    writeFileSync(join(dir, 'ohne.config.ts'), `export default ${JSON.stringify(config)}\n`);
  }

  function writeRoute(dir: string, file: string): void {
    writeFileSync(join(dir, 'api', file), 'export default () => null\n');
  }

  function link(consumer: string, name: string, target: string): void {
    const modules = join(consumer, 'node_modules');
    mkdirSync(modules, { recursive: true });
    symlinkSync(target, join(modules, name), 'dir');
  }

  before(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'ohne-watch-layers-')));
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  afterEach(() => {
    watch?.close();
    watch = undefined;
    useLayers().clear();
  });

  it('watches the app dir and skips the codegen output', async () => {
    const app = join(root, 'basic');
    manifest(app, 'basic', [], {});
    await loadLayers(app);
    changed = [];
    watch = watchLayers((path) => changed.push(path));
    await delay(50);

    writeRoute(app, 'health.ts');
    await waitFor(() => changed.some((path) => path.endsWith('/api/health.ts')));

    changed.length = 0;
    mkdirSync(join(app, '.ohne'), { recursive: true });
    writeFileSync(join(app, '.ohne', 'routes.ts'), '// generated\n');
    await delay(150);
    ok(!changed.some((path) => path.endsWith('/routes.ts')));
  });

  it('skips a custom codegen dir by basename', async () => {
    const app = join(root, 'customgen');
    manifest(app, 'customgen', [], { dirs: { codegen: 'gen' } });
    await loadLayers(app);
    changed = [];
    watch = watchLayers((path) => changed.push(path));
    await delay(50);

    mkdirSync(join(app, 'gen'), { recursive: true });
    writeFileSync(join(app, 'gen', 'routes.ts'), '// generated\n');
    await delay(150);
    ok(!changed.some((path) => path.endsWith('/routes.ts')));

    writeRoute(app, 'health.ts');
    await waitFor(() => changed.some((path) => path.endsWith('/api/health.ts')));
  });

  it('watches a layer outside node_modules but skips one under it', async () => {
    const ws = join(root, 'mixed-ws');
    const dep = join(root, 'mixed-app', 'node_modules', 'dep');
    mkdirSync(join(ws, 'api'), { recursive: true });
    mkdirSync(join(dep, 'api'), { recursive: true });
    useLayers().add({ path: ws });
    useLayers().add({ path: dep });
    changed = [];
    watch = watchLayers((path) => changed.push(path));
    await delay(50);

    writeFileSync(join(ws, 'api', 'a.ts'), 'export default () => null\n');
    await waitFor(() => changed.some((path) => path.endsWith('/mixed-ws/api/a.ts')));

    changed.length = 0;
    writeFileSync(join(dep, 'api', 'b.ts'), 'export default () => null\n');
    await delay(150);
    ok(!changed.some((path) => path.endsWith('/b.ts')));
  });

  it('resync re-ignores a renamed codegen dir on surviving watches', async () => {
    const app = join(root, 'regen-rename');
    manifest(app, 'regen-rename', [], { dirs: { codegen: 'gen' } });
    await loadLayers(app);
    changed = [];
    watch = watchLayers((path) => changed.push(path));
    await delay(50);

    writeFileSync(join(app, 'ohne.config.ts'), "export default { dirs: { codegen: 'gen2' } }\n");
    await loadLayers(app, { fresh: true });
    watch.resync();
    await delay(50);

    changed.length = 0;
    mkdirSync(join(app, 'gen2'), { recursive: true });
    writeFileSync(join(app, 'gen2', 'routes.ts'), '// generated\n');
    await delay(150);
    ok(!changed.some((path) => path.endsWith('/routes.ts')));

    writeRoute(app, 'health.ts');
    await waitFor(() => changed.some((path) => path.endsWith('/api/health.ts')));
  });

  it(
    'resync watches a newly stacked layer and unwatches a removed one',
    skipOnWindows,
    async () => {
      const ws = join(root, 'store2', 'ws');
      manifest(ws, 'ws', [], {});
      const app = join(root, 'resync');
      manifest(app, 'resync', ['ws'], { layers: ['ws'] });
      link(app, 'ws', ws);
      await loadLayers(app);
      changed = [];
      watch = watchLayers((path) => changed.push(path));
      await delay(50);

      writeRoute(ws, 'a.ts');
      await waitFor(() => changed.some((path) => path.endsWith('/ws/api/a.ts')));

      writeFileSync(join(app, 'ohne.config.ts'), 'export default {}\n');
      await loadLayers(app, { fresh: true });
      watch.resync();
      await delay(50);

      changed.length = 0;
      writeRoute(ws, 'c.ts');
      await delay(150);
      ok(!changed.some((path) => path.endsWith('/ws/api/c.ts')));

      writeRoute(app, 'd.ts');
      await waitFor(() => changed.some((path) => path.endsWith('/resync/api/d.ts')));
    },
  );
});

import { deepStrictEqual, strictEqual } from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';

import { createRegistryTarget } from '../../../../src/ohne/dev/targets/registry.ts';
import { loadLayers, useLayers } from '../../../../src/ohne/index.ts';

describe('registry target', () => {
  let root: string;

  function writeApp(name: string): string {
    const app = join(root, name);
    mkdirSync(app, { recursive: true });
    writeFileSync(join(app, 'package.json'), JSON.stringify({ name, type: 'module' }));
    writeFileSync(join(app, 'ohne.config.ts'), '');
    return app;
  }

  before(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'ohne-registry-target-')));
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  afterEach(() => {
    useLayers().clear();
  });

  it('is never affected by a changed path', async () => {
    const app = writeApp('unaffected');
    await loadLayers(app);
    const registry = createRegistryTarget(app);

    strictEqual(registry.affectedBy(join(app, 'ohne.config.ts')), false);
    strictEqual(registry.affectedBy(join(app, 'api', 'health.ts')), false);
  });

  it('regenerates the registry-derived types and returns their paths', async () => {
    const app = writeApp('regen');
    await loadLayers(app);
    const registry = createRegistryTarget(app);

    const written = (await registry.regen()).sort();
    deepStrictEqual(written, [
      join(app, '.ohne', 'node', 'layer-name.ts'),
      join(app, '.ohne', 'node', 'resolved-config.ts'),
    ]);
    for (const file of written) strictEqual(existsSync(file), true);
  });
});

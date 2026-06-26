import { deepStrictEqual, strictEqual } from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';

import { createConfigTarget } from '../../../../src/ohne/dev/targets/config.ts';
import { createRoutesTarget } from '../../../../src/ohne/dev/targets/routes.ts';
import { loadLayers, useConfig, useLayers } from '../../../../src/ohne/index.ts';

describe('config target', () => {
  let root: string;

  function writeApp(name: string): string {
    const app = join(root, name);
    mkdirSync(app, { recursive: true });
    writeFileSync(join(app, 'package.json'), JSON.stringify({ name, type: 'module' }));
    writeFileSync(join(app, 'ohne.config.ts'), '');
    return app;
  }

  function writeRoute(app: string, relative: string): void {
    const file = join(app, 'api', relative);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, 'export default () => null\n');
  }

  before(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'ohne-config-target-')));
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  afterEach(() => {
    useLayers().clear();
  });

  it('is affected only by an ohne.config.ts in the stack', async () => {
    const app = writeApp('affected');
    await loadLayers(app);
    const config = createConfigTarget(app, []);

    strictEqual(config.affectedBy(join(app, 'ohne.config.ts')), true);
    strictEqual(config.affectedBy(join(app, 'api', 'health.ts')), false);
    strictEqual(config.affectedBy(join(app, 'nested', 'ohne.config.ts')), false);
  });

  it('refreshes the registry and invalidates dependents', async () => {
    const app = writeApp('refresh');
    writeRoute(app, 'health.ts');
    await loadLayers(app);
    const routes = createRoutesTarget(app);
    const config = createConfigTarget(app, [routes]);
    const out = join(app, '.ohne', 'routes.ts');

    await routes.regen();
    rmSync(out);
    await routes.regen();
    strictEqual(existsSync(out), false);

    await config.regen();
    deepStrictEqual(
      useLayers()
        .layers()
        .map((layer) => layer.path),
      [app],
    );

    await routes.regen();
    strictEqual(existsSync(out), true);
  });

  it('re-resolves edited config content', async () => {
    const app = writeApp('content');
    await loadLayers(app);
    const config = createConfigTarget(app, []);

    writeFileSync(
      join(app, 'ohne.config.ts'),
      "export default { disable: { routes: ['GET /**'] } }\n",
    );
    await config.regen();
    deepStrictEqual(useConfig().disable.routes, ['GET /**']);
  });
});

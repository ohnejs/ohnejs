import { deepStrictEqual, rejects, strictEqual } from 'node:assert';
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

  it('is affected only by an ohne.config.ts or ohne.layer.ts in the stack', async () => {
    const app = writeApp('affected');
    await loadLayers(app);
    const config = createConfigTarget(app, []);

    strictEqual(config.affectedBy(join(app, 'ohne.config.ts')), true);
    strictEqual(config.affectedBy(join(app, 'ohne.layer.ts')), true);
    strictEqual(config.affectedBy(join(app, 'api', 'health.ts')), false);
    strictEqual(config.affectedBy(join(app, 'nested', 'ohne.config.ts')), false);
    strictEqual(config.affectedBy(join(app, 'nested', 'ohne.layer.ts')), false);
  });

  it('refreshes the registry and regenerates dependents', async () => {
    const app = writeApp('refresh');
    writeRoute(app, 'health.ts');
    await loadLayers(app);
    const routes = createRoutesTarget(app);
    const config = createConfigTarget(app, [routes]);
    const out = join(app, '.ohne', 'node', 'routes.ts');

    await routes.regen();
    rmSync(out);

    await config.regen();
    deepStrictEqual(
      useLayers()
        .layers()
        .map((layer) => layer.path),
      [app],
    );
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

  it('re-resolves edited layer defaults', async () => {
    const app = writeApp('defaults');
    writeFileSync(
      join(app, 'ohne.layer.ts'),
      "export default { defaults: { disable: { routes: ['GET /a'] } } }\n",
    );
    await loadLayers(app);
    const config = createConfigTarget(app, []);
    deepStrictEqual(useConfig().disable.routes, ['GET /a']);

    writeFileSync(
      join(app, 'ohne.layer.ts'),
      "export default { defaults: { disable: { routes: ['GET /b'] } } }\n",
    );
    await config.regen();
    deepStrictEqual(useConfig().disable.routes, ['GET /b']);
  });

  it('recovers config detection after a failed reload', async () => {
    const app = writeApp('recover');
    await loadLayers(app);
    const config = createConfigTarget(app, []);

    writeFileSync(join(app, 'ohne.config.ts'), 'export default {\n');
    await rejects(config.regen());
    strictEqual(config.affectedBy(join(app, 'ohne.config.ts')), true);

    writeFileSync(
      join(app, 'ohne.config.ts'),
      "export default { disable: { routes: ['GET /**'] } }\n",
    );
    await config.regen();
    deepStrictEqual(useConfig().disable.routes, ['GET /**']);
  });
});

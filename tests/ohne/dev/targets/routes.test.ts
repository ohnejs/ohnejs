import { strictEqual } from 'node:assert';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';

import { createRoutesTarget } from '../../../../src/ohne/dev/targets/routes.ts';
import { loadLayers, useLayers } from '../../../../src/ohne/index.ts';

describe('routes target', () => {
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
    root = realpathSync(mkdtempSync(join(tmpdir(), 'ohne-routes-target-')));
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  afterEach(() => {
    useLayers().clear();
  });

  it('is affected by paths inside the api dir, including brand-new files', async () => {
    const app = writeApp('affected');
    writeRoute(app, 'health.ts');
    await loadLayers(app);
    const target = createRoutesTarget(app);

    strictEqual(target.affectedBy(join(app, 'api', 'health.ts')), true);
    strictEqual(target.affectedBy(join(app, 'api', 'new.get.ts')), true);
    strictEqual(target.affectedBy(join(app, 'middleware', 'auth.ts')), false);
    strictEqual(target.affectedBy(join(app, 'README.md')), false);
  });

  it('writes, skips an unchanged set, regenerates a changed one', async () => {
    const app = writeApp('regen');
    writeRoute(app, 'health.ts');
    await loadLayers(app);
    const target = createRoutesTarget(app);
    const out = join(app, '.ohne', 'routes.ts');

    await target.regen();
    strictEqual(readFileSync(out, 'utf8').includes("'/health'"), true);

    rmSync(out);
    await target.regen();
    strictEqual(existsSync(out), false);

    writeRoute(app, 'users.get.ts');
    await target.regen();
    strictEqual(readFileSync(out, 'utf8').includes("'GET /users'"), true);
  });
});

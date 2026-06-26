import { strictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';

import { createMiddlewareTarget } from '../../../../src/ohne/dev/targets/middleware.ts';
import { loadLayers, useLayers } from '../../../../src/ohne/index.ts';

describe('middleware target', () => {
  let root: string;

  function writeApp(name: string): string {
    const app = join(root, name);
    mkdirSync(app, { recursive: true });
    writeFileSync(join(app, 'package.json'), JSON.stringify({ name, type: 'module' }));
    writeFileSync(join(app, 'ohne.config.ts'), '');
    return app;
  }

  function writeMiddleware(app: string, relative: string): void {
    const file = join(app, 'middleware', relative);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, 'export default () => null\n');
  }

  before(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'ohne-middleware-target-')));
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  afterEach(() => {
    useLayers().clear();
  });

  it('gates on its own dir and writes the table', async () => {
    const app = writeApp('regen');
    writeMiddleware(app, 'auth.ts');
    await loadLayers(app);
    const target = createMiddlewareTarget(app);
    const out = join(app, '.ohne', 'middleware.ts');

    strictEqual(target.affectedBy(join(app, 'middleware', 'auth.ts')), true);
    strictEqual(target.affectedBy(join(app, 'api', 'health.ts')), false);

    await target.regen();
    strictEqual(readFileSync(out, 'utf8').includes("'auth'"), true);
  });
});

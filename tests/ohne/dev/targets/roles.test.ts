import { strictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';

import { createRolesTarget } from '../../../../src/ohne/dev/targets/roles.ts';
import { loadLayers, useLayers } from '../../../../src/ohne/index.ts';

describe('roles target', () => {
  let root: string;

  function writeApp(name: string): string {
    const app = join(root, name);
    mkdirSync(app, { recursive: true });
    writeFileSync(join(app, 'package.json'), JSON.stringify({ name, type: 'module' }));
    writeFileSync(join(app, 'ohne.config.ts'), '');
    return app;
  }

  function writeRole(app: string, relative: string, content?: string): void {
    const file = join(app, 'roles', relative);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, content ?? "export default { capabilities: ['*'] };\n");
  }

  before(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'ohne-roles-target-')));
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  afterEach(() => {
    useLayers().clear();
  });

  it('gates on its own dir and writes the table', async () => {
    const app = writeApp('regen');
    writeRole(app, 'editor.ts');
    await loadLayers(app);
    const target = createRolesTarget(app);
    const out = join(app, '.ohne', 'node', 'roles.ts');

    strictEqual(target.affectedBy(join(app, 'roles', 'editor.ts')), true);
    strictEqual(target.affectedBy(join(app, 'api', 'health.ts')), false);

    await target.regen();
    strictEqual(readFileSync(out, 'utf8').includes("'editor'"), true);
  });

  it('re-imports a fixed role file past the module cache', async () => {
    const app = writeApp('fresh');
    writeRole(app, 'editor.ts', 'export const nope = 1;\n');
    await loadLayers(app);
    const target = createRolesTarget(app);

    await target.regen().then(
      () => strictEqual(true, false, 'a broken role file must fail the regen'),
      () => {},
    );

    writeRole(app, 'editor.ts');
    target.invalidate();
    await target.regen();
    const out = readFileSync(join(app, '.ohne', 'node', 'roles.ts'), 'utf8');
    strictEqual(out.includes("roles.register('editor'"), true);
  });
});

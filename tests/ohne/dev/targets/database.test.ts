import { ok, strictEqual } from 'node:assert';
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

import { createDatabaseTarget } from '../../../../src/ohne/dev/targets/database.ts';
import { loadLayers, useLayers } from '../../../../src/ohne/index.ts';

describe('database target', () => {
  let root: string;

  function writeApp(name: string): string {
    const app = join(root, name);
    mkdirSync(app, { recursive: true });
    writeFileSync(join(app, 'package.json'), JSON.stringify({ name, type: 'module' }));
    writeFileSync(join(app, 'ohne.config.ts'), '');
    return app;
  }

  function writeMigration(app: string, relative: string): void {
    const file = join(app, 'migrations', relative);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, 'export default { from: { table: "Posts" }, to: null };\n');
  }

  before(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'ohne-database-target-')));
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  afterEach(() => {
    useLayers().clear();
  });

  it('is affected by paths inside the migrations dir, including brand-new files', async () => {
    const app = writeApp('affected');
    writeMigration(app, '001-posts.ts');
    await loadLayers(app);
    const target = createDatabaseTarget(app);

    strictEqual(target.affectedBy(join(app, 'migrations', '001-posts.ts')), true);
    strictEqual(target.affectedBy(join(app, 'migrations', '002-new.ts')), true);
    strictEqual(target.affectedBy(join(app, 'api', 'health.ts')), false);
    strictEqual(target.affectedBy(join(app, 'README.md')), false);
  });

  it('writes, skips an unchanged set, regenerates a changed one', async () => {
    const app = writeApp('regen');
    writeMigration(app, '001-posts.ts');
    await loadLayers(app);
    const target = createDatabaseTarget(app);
    const out = join(app, '.ohne', 'node', 'database.ts');

    await target.regen();
    ok(readFileSync(out, 'utf8').includes('001-posts'));

    rmSync(out);
    await target.regen();
    strictEqual(existsSync(out), false);

    writeMigration(app, '002-drafts.ts');
    await target.regen();
    ok(readFileSync(out, 'utf8').includes('002-drafts'));
  });
});

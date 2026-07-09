import { ok, strictEqual } from 'node:assert';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  utimesSync,
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

  function writeCollection(app: string, fieldName: string): string {
    const file = join(app, 'collections', 'Posts.ts');
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(
      file,
      `export default { fields: { ${fieldName}: { type: 'text', options: {} } } };\n`,
    );
    return file;
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

  it('is affected by paths inside any of the three schema dirs', async () => {
    const app = writeApp('affected');
    await loadLayers(app);
    const target = createDatabaseTarget(app);

    strictEqual(target.affectedBy(join(app, 'collections', 'Posts.ts')), true);
    strictEqual(target.affectedBy(join(app, 'fields', 'slug.ts')), true);
    strictEqual(target.affectedBy(join(app, 'migrations', '001-posts.ts')), true);
    strictEqual(target.affectedBy(join(app, 'api', 'health.ts')), false);
    strictEqual(target.affectedBy(join(app, 'README.md')), false);
  });

  it('re-imports an edited definition fresh on regen', async () => {
    const app = writeApp('fresh');
    const file = writeCollection(app, 'title');
    await loadLayers(app);
    const target = createDatabaseTarget(app);
    const shared = join(app, '.ohne', 'shared', 'database.ts');

    await target.regen();
    ok(readFileSync(shared, 'utf8').includes('title: string;'));

    writeCollection(app, 'slug');
    utimesSync(file, new Date(), new Date(Date.now() + 1000));
    await target.regen();
    ok(readFileSync(shared, 'utf8').includes('slug: string;'));
  });
});

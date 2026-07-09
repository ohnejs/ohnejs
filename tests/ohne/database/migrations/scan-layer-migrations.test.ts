import { deepStrictEqual, rejects } from 'node:assert';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { scanLayerMigrations } from '../../../../src/ohne/index.ts';

describe('scanLayerMigrations', () => {
  let root: string;

  function writeMigration(dir: string, relative: string): void {
    const file = join(dir, 'migrations', relative);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, 'export default { from: { table: "Posts" }, to: null };\n');
  }

  before(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'ohne-scan-migrations-')));
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('maps files to layer-qualified names, in natural name order', async () => {
    const dir = join(root, 'ordered');
    writeMigration(dir, '0010-later.ts');
    writeMigration(dir, '002-first.ts');
    writeMigration(dir, 'sub/deep.ts');
    const scanned = await scanLayerMigrations({ name: 'app', dir }, 'migrations');
    deepStrictEqual(
      scanned.map((migration) => migration.name),
      ['app/002-first', 'app/0010-later', 'app/sub/deep'],
    );
    deepStrictEqual(scanned[0]?.file, join(dir, 'migrations', '002-first.ts'));
  });

  it('skips underscore-prefixed helper files and directories', async () => {
    const dir = join(root, 'helpers');
    writeMigration(dir, '001-posts.ts');
    writeMigration(dir, '_transforms.ts');
    writeMigration(dir, '_lib/shared.ts');
    const scanned = await scanLayerMigrations({ name: 'app', dir }, 'migrations');
    deepStrictEqual(
      scanned.map((migration) => migration.name),
      ['app/001-posts'],
    );
  });

  it('returns an empty list without a migrations directory', async () => {
    deepStrictEqual(
      await scanLayerMigrations({ name: 'app', dir: join(root, 'none') }, 'migrations'),
      [],
    );
  });

  it('rejects an unimportable migration path', async () => {
    const dir = join(root, 'weird');
    writeMigration(dir, 'we%ird.ts');
    await rejects(scanLayerMigrations({ name: 'app', dir }, 'migrations'), /Unsupported character/);
  });
});

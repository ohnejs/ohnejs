import { deepStrictEqual, doesNotMatch, match, ok, strictEqual } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, it } from 'node:test';

const FRAMEWORK = join(import.meta.dirname, '..', '..', '..', '..');
const MAIN = join(FRAMEWORK, 'src', 'ohne', 'cli', 'main.ts');

describe('ohne sync', () => {
  let root: string;

  function makeApp(name: string): string {
    const dir = mkdtempSync(join(root, `${name}-`));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, type: 'module' }));
    writeFileSync(join(dir, 'ohne.config.ts'), '');
    mkdirSync(join(dir, 'node_modules'), { recursive: true });
    symlinkSync(FRAMEWORK, join(dir, 'node_modules', 'ohne'), 'dir');
    return dir;
  }

  function writeNotes(dir: string): void {
    mkdirSync(join(dir, 'collections'), { recursive: true });
    writeFileSync(
      join(dir, 'collections', 'Notes.ts'),
      "import { defineCollection, field } from 'ohne';\n" +
        "export default defineCollection({ fields: { body: field('text') } });\n",
    );
  }

  function sync(dir: string, ...flags: string[]): { status: number | null; output: string } {
    const env: Record<string, string | undefined> = { ...process.env, NO_COLOR: '1' };
    for (const name of ['DATABASE', 'DB', 'FORCE_SYNC', 'SILENT']) delete env[name];
    const result = spawnSync(process.execPath, [MAIN, 'sync', '--cwd', dir, ...flags], {
      encoding: 'utf8',
      env,
    });
    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  }

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'ohne-sync-'));
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('syncs a fresh database from the collections, idempotent on a re-run', () => {
    const dir = makeApp('app');
    writeNotes(dir);

    const first = sync(dir);
    strictEqual(first.status, 0);
    match(first.output, /Database synced/);
    ok(existsSync(join(dir, '.data', 'ohne.db')));

    const db = new DatabaseSync(join(dir, '.data', 'ohne.db'));
    const columns = db
      .prepare('PRAGMA table_info("Notes")')
      .all()
      .map((row) => row.name);
    db.close();
    deepStrictEqual(columns, ['UUID', '_updatedAt', 'body']);

    const again = sync(dir);
    strictEqual(again.status, 0);
    match(again.output, /Database synced/);
  });

  it('reports a discard migration sweeping block data, no force involved', () => {
    const dir = makeApp('blocks');
    mkdirSync(join(dir, 'collections'), { recursive: true });
    mkdirSync(join(dir, 'blocks'), { recursive: true });
    writeFileSync(
      join(dir, 'blocks', 'Hero.ts'),
      "import { defineBlock, field } from 'ohne';\n" +
        "export default defineBlock({ fields: { title: field('text') } });\n",
    );
    writeFileSync(
      join(dir, 'collections', 'Pages.ts'),
      "import { defineCollection, field } from 'ohne';\n" +
        "export default defineCollection({ fields: { content: field('blocks') } });\n",
    );
    strictEqual(sync(dir).status, 0);

    const db = new DatabaseSync(join(dir, '.data', 'ohne.db'));
    db.prepare('INSERT INTO "Pages" ("UUID", "_updatedAt") VALUES (?, ?)').run('p1', 0);
    db.prepare('INSERT INTO "block_Hero" ("UUID", "title") VALUES (?, ?)').run('h1', 'Hi');
    db.prepare(
      'INSERT INTO "Pages_content" ("UUID", "_parentUUID", "_parentPosition", "_blockType", "_blockUUID") ' +
        'VALUES (?, ?, ?, ?, ?)',
    ).run('w1', 'p1', 0, 'Hero', 'h1');
    db.close();

    writeFileSync(
      join(dir, 'collections', 'Pages.ts'),
      "import { defineCollection } from 'ohne';\n" +
        'export default defineCollection({ fields: {} });\n',
    );
    mkdirSync(join(dir, 'migrations'), { recursive: true });
    writeFileSync(
      join(dir, 'migrations', '001-drop-content.ts'),
      "import { defineMigration } from 'ohne';\n" +
        "export default defineMigration({ from: { collection: 'Pages', field: 'content' }, to: null });\n",
    );

    const discarded = sync(dir);
    strictEqual(discarded.status, 0);
    match(discarded.output, /Migrations removed data/);
    match(discarded.output, /1 row of block_Hero deleted, no longer referenced/);
    doesNotMatch(discarded.output, /under force/);

    const after = new DatabaseSync(join(dir, '.data', 'ohne.db'));
    const tables = after
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'block%'")
      .all();
    after.close();
    deepStrictEqual(tables, []);
  });

  it('refuses a destructive change, then performs it under --force', () => {
    const dir = makeApp('destructive');
    writeNotes(dir);
    strictEqual(sync(dir).status, 0);

    const db = new DatabaseSync(join(dir, '.data', 'ohne.db'));
    db.prepare('INSERT INTO "Notes" ("UUID", "_updatedAt", "body") VALUES (?, ?, ?)').run(
      'n1',
      0,
      'kept',
    );
    db.close();
    rmSync(join(dir, 'collections', 'Notes.ts'));

    const refused = sync(dir);
    strictEqual(refused.status, 1);
    match(refused.output, /Destructive sync refused/);
    match(refused.output, /table Notes \(1 row\)/);
    match(refused.output, /FORCE_SYNC/);

    const forced = sync(dir, '--force');
    strictEqual(forced.status, 0);
    match(forced.output, /Sync removed data under force/);
    match(forced.output, /table Notes \(1 row\)/);
    match(forced.output, /Database synced/);

    const after = new DatabaseSync(join(dir, '.data', 'ohne.db'));
    const tables = after
      .prepare('SELECT name FROM sqlite_master WHERE type = ? AND name = ?')
      .all('table', 'Notes');
    after.close();
    deepStrictEqual(tables, []);
  });

  it('refuses to run outside an ohne project', () => {
    const dir = mkdtempSync(join(root, 'plain-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'plain' }));

    const result = sync(dir);
    strictEqual(result.status, 1);
    match(result.output, /Not an ohne project/);
    strictEqual(existsSync(join(dir, '.data')), false);
  });
});

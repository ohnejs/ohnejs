import { deepStrictEqual, doesNotMatch, match, ok, strictEqual } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { dialect, prepareProject, sharedURL } from '../../../_dialect.ts';

const FRAMEWORK = join(import.meta.dirname, '..', '..', '..', '..');
const MAIN = join(FRAMEWORK, 'src', 'ohne', 'cli', 'main.ts');

describe('ohne sync', () => {
  let root: string;

  async function makeApp(name: string): Promise<{ dir: string; url: string }> {
    const dir = mkdtempSync(join(root, `${name}-`));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, type: 'module' }));
    mkdirSync(join(dir, 'node_modules'), { recursive: true });
    symlinkSync(FRAMEWORK, join(dir, 'node_modules', 'ohnejs'), 'dir');
    return { dir, url: await prepareProject(dir) };
  }

  async function tablesOf(url: string): Promise<string[]> {
    const db = await dialect.connect(url);
    const tables = await dialect.listTables(db);
    await db.close();
    return tables;
  }

  function writeNotes(dir: string): void {
    mkdirSync(join(dir, 'collections'), { recursive: true });
    writeFileSync(
      join(dir, 'collections', 'Notes.ts'),
      "import { defineCollection, field } from 'ohnejs';\n" +
        "export default defineCollection({ fields: { body: field('text') } });\n",
    );
  }

  function syncWith(
    dir: string,
    extra: Record<string, string>,
    ...flags: string[]
  ): { status: number | null; output: string } {
    const env: Record<string, string | undefined> = { ...process.env, NO_COLOR: '1' };
    for (const name of ['DATABASE', 'DB', 'FORCE_SYNC', 'SILENT']) delete env[name];
    Object.assign(env, extra);
    const result = spawnSync(process.execPath, [MAIN, 'sync', '--cwd', dir, ...flags], {
      encoding: 'utf8',
      env,
      timeout: 30_000,
    });
    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  }

  function sync(dir: string, ...flags: string[]): { status: number | null; output: string } {
    return syncWith(dir, {}, ...flags);
  }

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'ohne-sync-'));
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('syncs a fresh database from the collections, idempotent on a re-run', async () => {
    const { dir, url } = await makeApp('app');
    writeNotes(dir);

    const first = sync(dir);
    strictEqual(first.status, 0);
    match(first.output, /Database synced/);

    const db = await dialect.connect(url);
    const { columns } = await dialect.describeTable(db, 'Notes');
    await db.close();
    deepStrictEqual(
      columns.map((column) => column.name),
      ['UUID', '_updatedAt', 'body'],
    );

    const again = sync(dir);
    strictEqual(again.status, 0);
    match(again.output, /Database synced/);
  });

  it('reads `DATABASE` from the project `.env`, unless the shell already set it', async () => {
    const { dir, url } = await makeApp('dotenv');
    writeNotes(dir);
    const shell = await sharedURL();

    strictEqual(sync(dir).status, 0);
    ok((await tablesOf(url)).includes('Notes'));
    deepStrictEqual(await tablesOf(shell), []);

    strictEqual(syncWith(dir, { DATABASE: shell }).status, 0);
    ok((await tablesOf(shell)).includes('Notes'));
  });

  it('syncs `.data/ohne.db` when no `DATABASE` is set', async () => {
    const { dir } = await makeApp('default');
    writeNotes(dir);
    rmSync(join(dir, '.env'));

    strictEqual(sync(dir).status, 0);
    ok(existsSync(join(dir, '.data', 'ohne.db')));
  });

  it('reports a malformed `.env` through the error funnel', async () => {
    const { dir } = await makeApp('bad-dotenv');
    writeNotes(dir);
    writeFileSync(join(dir, '.env'), 'NOEQUALS\n');

    const result = sync(dir);
    strictEqual(result.status, 1);
    match(result.output, /Could not load \.env/);
    match(result.output, /expected "=" after key "NOEQUALS"/);
    doesNotMatch(result.output, /Database synced/);
  });

  it('reports a discard migration sweeping block data, no force involved', async () => {
    const { dir, url } = await makeApp('blocks');
    mkdirSync(join(dir, 'collections'), { recursive: true });
    mkdirSync(join(dir, 'blocks'), { recursive: true });
    writeFileSync(
      join(dir, 'blocks', 'Hero.ts'),
      "import { defineBlock, field } from 'ohnejs';\n" +
        "export default defineBlock({ fields: { title: field('text') } });\n",
    );
    writeFileSync(
      join(dir, 'collections', 'Pages.ts'),
      "import { defineCollection, field } from 'ohnejs';\n" +
        "export default defineCollection({ fields: { content: field('blocks') } });\n",
    );
    strictEqual(sync(dir).status, 0);

    const db = await dialect.connect(url);
    await db.run('INSERT INTO "Pages" ("UUID", "_updatedAt") VALUES (?, ?)', ['p1', 0]);
    await db.run('INSERT INTO "block_Hero" ("UUID", "title") VALUES (?, ?)', ['h1', 'Hi']);
    await db.run(
      'INSERT INTO "Pages_content" ("UUID", "_parentUUID", "_parentPosition", "_blockType", "_blockUUID") ' +
        'VALUES (?, ?, ?, ?, ?)',
      ['w1', 'p1', 0, 'Hero', 'h1'],
    );
    await db.close();

    writeFileSync(
      join(dir, 'collections', 'Pages.ts'),
      "import { defineCollection } from 'ohnejs';\n" +
        'export default defineCollection({ fields: {} });\n',
    );
    mkdirSync(join(dir, 'migrations'), { recursive: true });
    writeFileSync(
      join(dir, 'migrations', '001-drop-content.ts'),
      "import { defineMigration } from 'ohnejs';\n" +
        "export default defineMigration({ from: { collection: 'Pages', field: 'content' }, to: null });\n",
    );

    const discarded = sync(dir);
    strictEqual(discarded.status, 0);
    match(discarded.output, /Migrations removed data/);
    match(discarded.output, /1 row of block_Hero deleted, no longer referenced/);
    doesNotMatch(discarded.output, /under force/);

    deepStrictEqual(
      (await tablesOf(url)).filter((name) => name.startsWith('block')),
      [],
    );
  });

  it('refuses a destructive change, then performs it under --force', async () => {
    const { dir, url } = await makeApp('destructive');
    writeNotes(dir);
    strictEqual(sync(dir).status, 0);

    const db = await dialect.connect(url);
    await db.run('INSERT INTO "Notes" ("UUID", "_updatedAt", "body") VALUES (?, ?, ?)', [
      'n1',
      0,
      'kept',
    ]);
    await db.close();
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

    strictEqual((await tablesOf(url)).includes('Notes'), false);
  });

  it('boots like `serve api`, so a `schema:synced` hook sees the routes, roles, and messages', async () => {
    const { dir } = await makeApp('registries');
    writeNotes(dir);
    for (const sub of ['api', 'boot', 'messages', 'roles']) mkdirSync(join(dir, sub));
    writeFileSync(
      join(dir, 'api', 'hello.get.ts'),
      "import { defineHandler } from 'ohnejs';\nexport default defineHandler(() => 'hi');\n",
    );
    writeFileSync(
      join(dir, 'roles', 'editor.ts'),
      "import { defineRole } from 'ohnejs';\n" +
        "export default defineRole({ capabilities: ['collection.Notes.*'] });\n",
    );
    writeFileSync(join(dir, 'messages', 'en.json'), '{ "notes": { "hi": "Hi" } }');
    writeFileSync(
      join(dir, 'boot', 'probe.ts'),
      "import { hook, useMessages, useRoles, useRoutes } from 'ohnejs';\n" +
        "hook('schema:synced', () => {\n" +
        '  const seen = [useRoutes().keys(), useRoles().keys(), useMessages().keys()];\n' +
        "  console.log('seen', JSON.stringify(seen));\n" +
        '});\n',
    );

    const result = sync(dir);
    strictEqual(result.status, 0);
    match(result.output, /seen \[\["GET \/hello"\],\["editor"\],\["en"\]\]/);
  });

  it('runs the shutdown hooks a boot file registers, so an open timer cannot hold the process', async () => {
    const { dir } = await makeApp('timer');
    mkdirSync(join(dir, 'boot'));
    writeFileSync(
      join(dir, 'boot', 'timer.ts'),
      "import { onShutdown } from 'ohnejs';\n" +
        'const timer = setInterval(() => {}, 1000);\n' +
        'onShutdown(() => clearInterval(timer));\n',
    );

    const result = sync(dir);
    strictEqual(result.status, 0);
    match(result.output, /Database synced/);
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

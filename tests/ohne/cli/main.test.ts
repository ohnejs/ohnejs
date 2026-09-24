import { match, strictEqual } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, it } from 'node:test';

const FRAMEWORK = join(import.meta.dirname, '..', '..', '..');
const MAIN = join(FRAMEWORK, 'src', 'ohne', 'cli', 'main.ts');

describe('ohne', () => {
  let root: string;

  function makeApp(name: string, config = ''): string {
    const dir = mkdtempSync(join(root, `${name}-`));
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name, type: 'module', dependencies: { ohnejs: '*' } }),
    );
    writeFileSync(join(dir, 'ohne.config.ts'), config);
    mkdirSync(join(dir, 'node_modules'));
    symlinkSync(FRAMEWORK, join(dir, 'node_modules', 'ohnejs'), 'dir');
    return dir;
  }

  function writeCommand(dir: string, name: string, imports: string, body: string): void {
    mkdirSync(join(dir, 'commands'), { recursive: true });
    writeFileSync(
      join(dir, 'commands', `${name}.ts`),
      `${imports}\n` +
        "import { defineCommand } from 'ohnejs/utils/cli';\n" +
        `export default defineCommand({ meta: { name: '${name}' }, async run() {\n${body}\n} });\n`,
    );
  }

  function ohne(cwd: string, ...args: string[]): { status: number | null; output: string } {
    const env: Record<string, string | undefined> = { ...process.env, NO_COLOR: '1' };
    for (const name of ['DATABASE', 'DB', 'FORCE_SYNC', 'SILENT']) delete env[name];
    const result = spawnSync(process.execPath, [MAIN, ...args], { cwd, encoding: 'utf8', env });
    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  }

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'ohne-main-'));
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('lists the commands of the app and its layers in the root help, each with its description', () => {
    const dir = makeApp('help', "export default { layers: ['ohnejs/uploads'] };\n");
    mkdirSync(join(dir, 'commands'));
    writeFileSync(
      join(dir, 'commands', 'muster.ts'),
      "import { defineCommand } from 'ohnejs/utils/cli';\n" +
        "export default defineCommand({ meta: { name: 'muster', description: 'Rally the Horde.' } });\n",
    );

    const result = ohne(dir, '--help');
    strictEqual(result.status, 0);
    match(result.output, /^ {2}muster +Rally the Horde\.$/m);
    match(result.output, /^ {2}uploads +Maintain the uploads storage\.$/m);
    match(result.output, /^ {2}sync +Sync the database schema\.$/m);
  });

  it('runs a command in the `--cwd` project, querying a collection `ohne sync` created there', () => {
    const dir = makeApp('notes');
    mkdirSync(join(dir, 'collections'));
    writeFileSync(
      join(dir, 'collections', 'Notes.ts'),
      "import { defineCollection, field } from 'ohnejs';\n" +
        "export default defineCollection({ fields: { body: field('text') } });\n",
    );
    writeCommand(
      dir,
      'notes',
      "import { queryUntyped } from 'ohnejs';",
      "const notes = await queryUntyped('Notes').findMany();\n" +
        "console.log(`notes: ${notes.map((note) => note.body).join(', ')}`);",
    );
    strictEqual(ohne(root, 'sync', '--cwd', dir).status, 0);
    const db = new DatabaseSync(join(dir, '.data', 'ohne.db'));
    db.prepare('INSERT INTO "Notes" ("UUID", "_updatedAt", "body") VALUES (?, ?, ?)').run(
      'n1',
      0,
      'Thrall rides at dawn',
    );
    db.close();

    const result = ohne(root, 'notes', '--cwd', dir);
    strictEqual(result.status, 0);
    match(result.output, /^notes: Thrall rides at dawn$/m);
  });

  it('runs an `onShutdown` hook the command registers once its `run` returns', () => {
    const dir = makeApp('shutdown');
    writeCommand(
      dir,
      'farewell',
      "import { onShutdown } from 'ohnejs';",
      "onShutdown(() => console.log('hook'));\nconsole.log('run');",
    );

    const result = ohne(root, 'farewell', '--cwd', dir);
    strictEqual(result.status, 0);
    match(result.output, /^run\nhook$/m);
  });

  it("keeps the database open for the command's own shutdown hooks", () => {
    const dir = makeApp('last');
    writeCommand(
      dir,
      'tally',
      "import { onShutdown, useDatabase } from 'ohnejs';",
      'onShutdown(async () => {\n' +
        "  const [row] = await useDatabase().query<{ answer: number }>('SELECT 42 AS answer');\n" +
        '  console.log(`answer ${row?.answer}`);\n' +
        '});',
    );

    const result = ohne(root, 'tally', '--cwd', dir);
    strictEqual(result.status, 0);
    match(result.output, /^answer 42$/m);
  });

  it('prints a thrown `ohneError` once, exits 1, and still runs the shutdown hooks', () => {
    const dir = makeApp('throws');
    writeCommand(
      dir,
      'betray',
      "import { ohneError, onShutdown } from 'ohnejs';",
      "onShutdown(() => console.log('hook'));\n" +
        "throw ohneError({ title: 'Arthas took Frostmourne', body: ['Lordaeron fell.'] });",
    );

    const result = ohne(root, 'betray', '--cwd', dir);
    strictEqual(result.status, 1);
    strictEqual(result.output.match(/Arthas took Frostmourne/g)?.length, 1);
    match(result.output, /Lordaeron fell\./);
    match(result.output, /^hook$/m);
  });

  it('keeps the `process.exitCode` a command sets', () => {
    const dir = makeApp('exit');
    writeCommand(dir, 'retreat', '', 'process.exitCode = 3;');

    strictEqual(ohne(root, 'retreat', '--cwd', dir).status, 3);
  });
});

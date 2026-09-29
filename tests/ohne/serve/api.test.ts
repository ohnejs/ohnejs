import type { AddressInfo } from 'node:net';

import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { request } from 'node:http';
import { connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';

import type { GuardReport } from '../../../src/ohne/database/schema/guard.ts';

import { SQLiteDialect } from '../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { ensureSchemaTable, writeSnapshot } from '../../../src/ohne/database/schema/snapshot.ts';
import { isOhneError } from '../../../src/ohne/error/ohne-error.ts';
import {
  closeDatabases,
  type HTTPServer,
  serveAPI,
  shutdownServer,
  useCollections,
  useDatabase,
  useEnv,
  useHooks,
  usePrinter,
  useShutdown,
} from '../../../src/ohne/index.ts';
import { useRoutes } from '../../../src/ohne/routes/use-routes.ts';

const scope = globalThis as typeof globalThis & {
  __ohneServeBoot: string[];
  __ohneServeReady?: { host: string; port: number };
  __ohneSchemaSynced?: GuardReport;
};

function getBody(port: number, path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: 'localhost', port, path, headers: { connection: 'close' } },
      (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => resolve(body));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function get(port: number, path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: 'localhost', port, path, headers: { connection: 'close' } },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

const FRAMEWORK = join(import.meta.dirname, '..', '..', '..');
const BIN = join(FRAMEWORK, 'src', 'ohne', 'cli', 'bin.js');

const dialect = new SQLiteDialect();

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

function header(port: number, path: string, name: string): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: 'localhost', port, path, headers: { connection: 'close' } },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.headers[name] as string | undefined));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function refused(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: 'localhost', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(true));
  });
}

describe('serveAPI', () => {
  let root: string;
  let http: HTTPServer | undefined;

  function makeApp(name: string, mark: string): string {
    const dir = mkdtempSync(join(root, `${name}-`));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, type: 'module' }));
    writeFileSync(join(dir, 'ohne.config.ts'), '');
    mkdirSync(join(dir, 'boot'));
    writeFileSync(
      join(dir, 'boot', 'index.ts'),
      `globalThis.__ohneServeBoot.push(${JSON.stringify(mark)})\n`,
    );
    return dir;
  }

  // An app whose generated files can resolve the bare `ohnejs` import, with one route to dispatch.
  function serveable(name: string): string {
    const dir = makeApp(name, `${name}:boot`);
    mkdirSync(join(dir, 'node_modules'));
    symlinkSync(FRAMEWORK, join(dir, 'node_modules', 'ohnejs'), 'dir');
    mkdirSync(join(dir, 'api'));
    writeFileSync(
      join(dir, 'api', 'ping.get.ts'),
      "import { defineHandler } from 'ohnejs';\nexport default defineHandler(() => 'pong');\n",
    );
    return dir;
  }

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'ohne-serve-api-'));
    scope.__ohneServeBoot = [];
    useEnv().set('SILENT', true);
    useEnv().set('DATABASE', ':memory:');
    useEnv().set('PORT', 0);
    useEnv().set('NO_COLOR', true);
  });

  afterEach(async () => {
    if (http) await shutdownServer(http.server, http.gate);
    http = undefined;
    await closeDatabases();
    useShutdown().clear();
    useShutdown().unwatch();
    useHooks().clear();
    useCollections().clear();
    useEnv().unset('SKIP_CODEGEN');
    useEnv().fill({});
    scope.__ohneSchemaSynced = undefined;
  });

  after(() => {
    useEnv().unset('SILENT');
    useEnv().unset('DATABASE');
    useEnv().unset('PORT');
    useEnv().unset('NO_COLOR');
    rmSync(root, { recursive: true, force: true });
  });

  it('reads the project `.env` without overriding the process environment', async () => {
    const dir = serveable('dotenv');
    writeFileSync(join(dir, '.env'), 'OHNE_TEST_GREETING=hi\nOHNE_TEST_KEEP=file\n');
    writeFileSync(
      join(dir, 'api', 'env.get.ts'),
      "import { defineHandler } from 'ohnejs';\n" +
        'export default defineHandler(() => ' +
        "`${process.env['OHNE_TEST_GREETING']}:${process.env['OHNE_TEST_KEEP']}`);\n",
    );
    process.env['OHNE_TEST_KEEP'] = 'shell';
    try {
      http = await serveAPI(dir);
      const { port } = http.server.address() as AddressInfo;
      strictEqual(await getBody(port, '/env'), 'hi:shell');
    } finally {
      delete process.env['OHNE_TEST_KEEP'];
    }
  });

  it('boots the layers, then generates the codegen files and prunes stale ones', async () => {
    const dir = makeApp('app', 'app:boot');
    mkdirSync(join(dir, '.ohne'));
    writeFileSync(join(dir, '.ohne', 'stale.ts'), '// Generated by ohne. Do not edit.\n');

    http = await serveAPI(dir);

    strictEqual(scope.__ohneServeBoot.includes('app:boot'), true);
    strictEqual(existsSync(join(dir, '.ohne', 'node', 'layer-name.ts')), true);
    strictEqual(existsSync(join(dir, '.ohne', 'node', 'resolved-config.ts')), true);
    strictEqual(existsSync(join(dir, '.ohne', 'browser', 'tsconfig.json')), true);
    strictEqual(existsSync(join(dir, '.ohne', 'stale.ts')), false);
  });

  it('boots but skips codegen when `SKIP_CODEGEN` is set', async () => {
    const dir = makeApp('skip', 'skip:boot');
    useEnv().set('SKIP_CODEGEN', true);

    http = await serveAPI(dir);

    strictEqual(scope.__ohneServeBoot.includes('skip:boot'), true);
    strictEqual(existsSync(join(dir, '.ohne')), false);
  });

  it('warns under `SKIP_CODEGEN` when another ohne version generated the files', async () => {
    const dir = serveable('stalestamp');
    http = await serveAPI(dir);
    await shutdownServer(http.server, http.gate);
    http = undefined;
    await closeDatabases();

    const routes = join(dir, '.ohne', 'node', 'routes.ts');
    const doctored = readFileSync(routes, 'utf8').replace(
      /^.*\n/,
      '// Generated by ohne 0.0.0. Do not edit.\n',
    );
    writeFileSync(routes, doctored);

    const out: string[] = [];
    useEnv().set('SILENT', false);
    useEnv().set('SKIP_CODEGEN', true);
    usePrinter().configure({ stream: { write: (s) => out.push(s) } });
    try {
      http = await serveAPI(dir);
    } finally {
      usePrinter().configure({ stream: process.stderr });
      useEnv().set('SILENT', true);
    }

    const text = out.join('');
    strictEqual(text.includes('Generated files are stale'), true);
    strictEqual(text.includes('0.0.0'), true);
  });

  it('stays quiet under `SKIP_CODEGEN` when the stamp matches the running version', async () => {
    const dir = serveable('freshstamp');
    http = await serveAPI(dir);
    await shutdownServer(http.server, http.gate);
    http = undefined;
    await closeDatabases();

    const out: string[] = [];
    useEnv().set('SILENT', false);
    useEnv().set('SKIP_CODEGEN', true);
    usePrinter().configure({ stream: { write: (s) => out.push(s) } });
    try {
      http = await serveAPI(dir);
    } finally {
      usePrinter().configure({ stream: process.stderr });
      useEnv().set('SILENT', true);
    }

    strictEqual(out.join('').includes('Generated files are stale'), false);
  });

  it('connects and syncs the database before serving', async () => {
    const dir = makeApp('db', 'db:boot');

    http = await serveAPI(dir);

    const row = await useDatabase().queryOne<{ data: string }>(
      'SELECT "data" FROM "ohne_schema" WHERE "key" = ?',
      ['schema'],
    );
    ok(row);
    strictEqual((JSON.parse(row.data) as { generation: number }).generation, 1);
  });

  it('never serves when the sync refuses', async () => {
    const dir = makeApp('dbfail', 'dbfail:boot');
    const path = join(dir, 'data.db');
    useEnv().set('DATABASE', path);
    const seed = await dialect.connect(path);
    await ensureSchemaTable(seed, dialect);
    await seed.exec('CREATE TABLE "Orphans" ("UUID" TEXT NOT NULL, PRIMARY KEY ("UUID"))');
    await seed.run('INSERT INTO "Orphans" ("UUID") VALUES (?)', ['o1']);
    await writeSnapshot(seed, dialect, {
      generation: 1,
      hash: 'seeded',
      classification: { Orphans: { columns: { UUID: 'text' } } },
      ownership: true,
    });
    await seed.close();
    const port = await freePort();
    useEnv().set('PORT', port);

    await rejects(serveAPI(dir), /Destructive sync refused/);

    await rejects(get(port, '/'));
    useEnv().set('PORT', 0);
    useEnv().set('DATABASE', ':memory:');
  });

  it('never serves a route whose options are invalid', async () => {
    const dir = serveable('badlimit');
    writeFileSync(
      join(dir, 'api', 'search.get.ts'),
      "import { defineHandler } from 'ohnejs';\n" +
        "export default defineHandler(() => [], { rateLimit: { limit: 0, window: '1m' } });\n",
    );
    const port = await freePort();
    useEnv().set('PORT', port);

    await rejects(serveAPI(dir), (error: unknown) => {
      ok(isOhneError(error), String(error));
      strictEqual(error.title, 'Invalid options on route `GET /search`');
      deepStrictEqual(error.body, ['Invalid limit: 0']);
      ok(error.path?.endsWith(join('api', 'search.get.ts')), String(error.path));
      return true;
    });
    await rejects(get(port, '/'));
    useRoutes().delete('GET /search');
    useEnv().set('PORT', 0);
  });

  it('re-syncs a file database as a no-op on a second boot', async () => {
    const dir = makeApp('dbfile', 'dbfile:boot');
    useEnv().set('DATABASE', join(dir, 'data.db'));

    http = await serveAPI(dir);
    await shutdownServer(http.server, http.gate);
    http = undefined;
    await closeDatabases();
    http = await serveAPI(dir);

    const row = await useDatabase().queryOne<{ data: string }>(
      'SELECT "data" FROM "ohne_schema" WHERE "key" = ?',
      ['schema'],
    );
    ok(row);
    strictEqual((JSON.parse(row.data) as { generation: number }).generation, 1);
    useEnv().set('DATABASE', ':memory:');
  });

  it('builds the desired schema from the registered collections and syncs it', async () => {
    const dir = serveable('schema');
    mkdirSync(join(dir, 'collections'));
    writeFileSync(
      join(dir, 'collections', 'Posts.ts'),
      "import { defineCollection, field } from 'ohnejs';\n" +
        'export default defineCollection({\n' +
        '  fields: {\n' +
        "    title: field('text', { unique: true }),\n" +
        "    views: field('integer', { nullable: true, index: true }),\n" +
        "    email: field('text'),\n" +
        "    tenant: field('text'),\n" +
        '  },\n' +
        "  compositeIndexes: [{ fields: ['email', 'tenant'], unique: true }],\n" +
        '});\n',
    );

    http = await serveAPI(dir);

    const table = await dialect.describeTable(useDatabase(), 'Posts');
    strictEqual(table.name, 'Posts');
    deepStrictEqual(table.primaryKey, ['UUID']);
    deepStrictEqual(table.columns, [
      { name: 'UUID', type: 'text', notNull: true },
      { name: '_updatedAt', type: 'integer', notNull: true },
      { name: 'title', type: 'text', notNull: true },
      { name: 'views', type: 'integer', notNull: false },
      { name: 'email', type: 'text', notNull: true },
      { name: 'tenant', type: 'text', notNull: true },
    ]);
    deepStrictEqual(table.uniques.map((unique) => unique.name).sort(), [
      'UX__Posts__email_tenant',
      'UX__Posts__title',
    ]);
    deepStrictEqual(
      table.uniques.find((unique) => unique.name === 'UX__Posts__email_tenant')?.columns,
      ['email', 'tenant'],
    );
    deepStrictEqual(
      table.indexes.map((index) => index.name),
      ['IX__Posts__views'],
    );
  });

  it('listens and answers an unmatched request with 404', async () => {
    const dir = makeApp('serve', 'serve:boot');

    http = await serveAPI(dir);

    strictEqual(http.server.listening, true);
    const { port } = http.server.address() as AddressInfo;
    strictEqual(await get(port, '/missing'), 404);
  });

  it('imports the generated middleware table and runs it', async () => {
    const dir = serveable('mw');
    mkdirSync(join(dir, 'middleware', 'global'), { recursive: true });
    writeFileSync(
      join(dir, 'middleware', 'global', 'mark.ts'),
      "import { defineMiddleware } from 'ohnejs';\n" +
        'export default defineMiddleware((event) => {\n' +
        "  event.response.headers.set('x-mw', 'ran');\n" +
        '});\n',
    );

    http = await serveAPI(dir);
    const { port } = http.server.address() as AddressInfo;

    strictEqual(await get(port, '/ping'), 200);
    strictEqual(await header(port, '/ping', 'x-mw'), 'ran');
  });

  it('runs the server:ready hook once listening, with the bound host and port', async () => {
    const dir = serveable('ready');
    writeFileSync(
      join(dir, 'boot', 'index.ts'),
      "import { hook } from 'ohnejs';\n" +
        "hook('server:ready', (info) => {\n" +
        '  globalThis.__ohneServeReady = info;\n' +
        '});\n',
    );

    http = await serveAPI(dir);
    const { port } = http.server.address() as AddressInfo;

    strictEqual(scope.__ohneServeReady?.host, 'localhost');
    strictEqual(scope.__ohneServeReady?.port, port);
  });

  it('drains the server when the server:ready hook throws', async () => {
    const dir = serveable('ready-throws');
    writeFileSync(
      join(dir, 'boot', 'index.ts'),
      "import { hook } from 'ohnejs';\n" +
        "hook('server:ready', (info) => {\n" +
        '  globalThis.__ohneServeReady = info;\n' +
        "  throw new Error('warm-up failed');\n" +
        '});\n',
    );

    await rejects(() => serveAPI(dir), /warm-up failed/);

    ok(scope.__ohneServeReady);
    strictEqual(await refused(scope.__ohneServeReady.port), true);
  });

  it('runs the schema:synced hook once with a clean first-sync report', async () => {
    const dir = serveable('synced');
    writeFileSync(
      join(dir, 'boot', 'index.ts'),
      "import { hook } from 'ohnejs';\n" +
        "hook('schema:synced', (report) => {\n" +
        '  globalThis.__ohneSchemaSynced = report;\n' +
        '});\n',
    );

    http = await serveAPI(dir);

    deepStrictEqual(scope.__ohneSchemaSynced, { deletions: [], warnings: [] });
  });

  it('rejects a port outside 0-65535', async () => {
    const dir = makeApp('badport', 'badport:boot');
    useEnv().set('PORT', 99999);

    await rejects(() => serveAPI(dir), /Invalid server port/);

    useEnv().set('PORT', 0);
  });

  it('drains and exits cleanly when its dev parent is gone before it is ready', async () => {
    const dir = serveable('orphaned');
    const log = join(dir, 'hook.log');
    writeFileSync(
      join(dir, 'boot', 'index.ts'),
      "import { appendFileSync } from 'node:fs';\n" +
        "import { onShutdown } from 'ohnejs';\n" +
        "if (process.connected) await new Promise((resolve) => process.once('disconnect', resolve));\n" +
        'onShutdown(async () => {\n' +
        '  await new Promise((resolve) => setTimeout(resolve, 100));\n' +
        `  appendFileSync(${JSON.stringify(log)}, 'drained');\n` +
        '});\n',
    );

    const child = fork(BIN, ['serve', 'api', '--cwd', dir], {
      env: { ...process.env, DATABASE: ':memory:', PORT: '0', SILENT: '1' },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    let stderr = '';
    child.stderr!.on('data', (chunk) => (stderr += chunk));
    child.disconnect();
    const [[code]] = await Promise.all([once(child, 'exit'), once(child.stderr!, 'end')]);

    strictEqual(stderr, '');
    strictEqual(code, 0);
    strictEqual(readFileSync(log, 'utf8'), 'drained');
  });
});

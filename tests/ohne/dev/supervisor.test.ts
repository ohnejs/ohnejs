import { ok, strictEqual } from 'node:assert';
import { spawn } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { request } from 'node:http';
import { createServer, type AddressInfo, type Server as NetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { dev, type DevServer } from '../../../src/ohne/dev/supervisor.ts';
import { useEnv, useLayers, usePrinter, useShutdown } from '../../../src/ohne/index.ts';
// A layer under node_modules is TypeScript too; the dev binary installs this hook before anything else.
import '../../../src/ohne/runtime/register.js';

const BIN = fileURLToPath(new URL('../../../src/ohne/cli/bin.js', import.meta.url));
const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const TIMEOUT = { timeout: 30_000, skip: process.platform === 'win32' };

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

function get(port: number, path: string): Promise<number> {
  return new Promise((resolve) => {
    const req = request(
      { host: '127.0.0.1', port, path, headers: { connection: 'close' } },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      },
    );
    req.on('error', () => resolve(-1));
    req.end();
  });
}

function getBody(port: number, path: string): Promise<string> {
  return new Promise((resolve) => {
    const req = request(
      { host: '127.0.0.1', port, path, headers: { connection: 'close' } },
      (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => resolve(body));
      },
    );
    req.on('error', () => resolve(''));
    req.end();
  });
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await delay(50);
  }
}

function sseReload(
  port: number,
  path: string,
): { connected: Promise<void>; reloaded: Promise<void>; close: () => void } {
  let onConnect!: () => void;
  let onReload!: () => void;
  let onError!: (error: Error) => void;
  const connected = new Promise<void>((resolve) => (onConnect = resolve));
  const reloaded = new Promise<void>((resolve, reject) => {
    onReload = resolve;
    onError = reject;
  });
  const req = request({ host: '127.0.0.1', port, path }, (res) => {
    onConnect();
    let buffer = '';
    res.on('data', (chunk) => {
      buffer += chunk;
      if (buffer.includes('data: reload')) onReload();
    });
  });
  req.on('error', (error) => onError(error));
  req.end();
  return { connected, reloaded, close: () => req.destroy() };
}

/**
 * An `ohne dev` process a test runs, with everything it and its children printed.
 */
interface DevCLI {
  output: () => string;
  stop: () => Promise<void>;
}

/**
 * Spawns `ohne dev` for `app` with its output piped, so a test reads the children's blocks as well.
 */
function spawnDev(app: string): DevCLI {
  const child = spawn(process.execPath, [BIN, 'dev', '--cwd', app], {
    env: { ...process.env, NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let text = '';
  child.stdout.on('data', (chunk) => (text += chunk));
  child.stderr.on('data', (chunk) => (text += chunk));
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  return {
    output: () => text,
    stop: async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      await exited;
    },
  };
}

describe('dev', () => {
  let root: string;
  let servers: DevServer[];
  let clis: DevCLI[];

  function writeProject(name: string, port: number, silent = true): string {
    const app = join(root, name);
    mkdirSync(join(app, 'api'), { recursive: true });
    mkdirSync(join(app, 'node_modules'), { recursive: true });
    symlinkSync(REPO, join(app, 'node_modules', 'ohnejs'), 'dir');
    writeFileSync(join(app, 'package.json'), JSON.stringify({ name, type: 'module' }));
    writeFileSync(
      join(app, 'ohne.config.ts'),
      `export default { api: { port: ${port} }, printer: { silent: ${silent} } }\n`,
    );
    return app;
  }

  function writeRoute(app: string, file: string): void {
    writeFileSync(join(app, 'api', file), "export default () => 'ok'\n");
  }

  /**
   * Runs `ohne dev` as its own process, so the output holds what each child prints too.
   * The app config records each child's PID, for a test to stop it from outside.
   * It also makes `SIGUSR2` exit a child with code `3`, a crash the child reports itself.
   */
  async function startDev(
    name: string,
  ): Promise<{ app: string; cli: DevCLI; dashPort: number; apiPort: number }> {
    const dashPort = await freePort();
    const app = writeProject(name, 0);
    writeFileSync(
      join(app, 'ohne.config.ts'),
      "import { writeFileSync } from 'node:fs'\n" +
        "const backend = ['api', 'dashboard'].find((name) => process.argv.includes(name))\n" +
        'if (backend) {\n' +
        `  writeFileSync(${JSON.stringify(root)} + '/' + backend + '.pid', String(process.pid))\n` +
        '  process.on("SIGUSR2", () => process.exit(3))\n' +
        '}\n' +
        `export default { api: { port: 0 }, dashboard: { port: ${dashPort} } }\n`,
    );
    writeRoute(app, 'health.ts');

    const cli = spawnDev(app);
    clis.push(cli);
    await waitFor(async () => /API ready[\s\S]*Waiting for changes/.test(cli.output()));
    strictEqual(await get(dashPort, '/'), 200);
    const apiPort = Number(cli.output().match(/API ready at http:\/\/localhost:(\d+)/)?.[1]);
    return { app, cli, dashPort, apiPort };
  }

  /**
   * The PID of the running test's `backend` child.
   */
  function childPID(backend: 'api' | 'dashboard'): number {
    return Number(readFileSync(join(root, `${backend}.pid`), 'utf8'));
  }

  /**
   * Crashes the ready dashboard child, then binds its port, so the next start cannot take it.
   */
  async function holdDashboard(cli: DevCLI, port: number): Promise<NetServer> {
    const mark = cli.output().length;
    process.kill(childPID('dashboard'), 'SIGUSR2');
    await waitFor(async () => cli.output().slice(mark).includes('Waiting for changes'));
    const holder = createServer();
    await new Promise<void>((resolve) => holder.listen(port, resolve));
    return holder;
  }

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'ohne-supervisor-'));
    useEnv().set('NO_COLOR', true);
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
    useEnv().unset('NO_COLOR');
  });

  beforeEach(() => {
    servers = [];
    clis = [];
  });

  afterEach(async () => {
    for (const server of servers) await server.close();
    for (const cli of clis) await cli.stop();
    useShutdown().unwatch();
    useShutdown().clear();
    useLayers().clear();
    useEnv().unset('SILENT');
    useEnv().fill({});
  });

  it('serves routes and reloads when a route file is added', TIMEOUT, async () => {
    const port = await freePort();
    const app = writeProject('reload', port);
    writeRoute(app, 'health.ts');

    const server = await dev(app, { entry: BIN, dashboard: false });
    servers.push(server);

    await waitFor(async () => (await get(port, '/health')) === 200);
    strictEqual(await get(port, '/users'), 404);

    writeRoute(app, 'users.get.ts');
    await waitFor(async () => (await get(port, '/users')) === 200);

    await server.close();
    await waitFor(async () => (await get(port, '/health')) === -1);
  });

  it('reloads the API child when `.env` changes, and again when it goes', TIMEOUT, async () => {
    const port = await freePort();
    const app = writeProject('dotenv', port);
    writeFileSync(
      join(app, 'api', 'greet.ts'),
      "export default () => process.env['OHNE_TEST_GREETING'] ?? 'missing'\n",
    );
    writeFileSync(join(app, '.env'), 'OHNE_TEST_GREETING=hi\n');

    const server = await dev(app, { entry: BIN, dashboard: false });
    servers.push(server);
    await waitFor(async () => (await getBody(port, '/greet')) === 'hi');

    writeFileSync(join(app, '.env'), 'OHNE_TEST_GREETING=hello\n');
    await waitFor(async () => (await getBody(port, '/greet')) === 'hello');

    unlinkSync(join(app, '.env'));
    await waitFor(async () => (await getBody(port, '/greet')) === 'missing');
  });

  it('parks on a malformed `.env` and recovers on the next save', TIMEOUT, async () => {
    const port = await freePort();
    const app = writeProject('bad-dotenv', port);
    writeFileSync(
      join(app, 'api', 'greet.ts'),
      "export default () => process.env['OHNE_TEST_GREETING'] ?? 'missing'\n",
    );

    const out: string[] = [];
    useEnv().set('SILENT', false);
    usePrinter().configure({ stream: { write: (s) => out.push(s) } });
    try {
      const server = await dev(app, { entry: BIN, dashboard: false });
      servers.push(server);
      await waitFor(async () => (await getBody(port, '/greet')) === 'missing');

      out.length = 0;
      writeFileSync(join(app, '.env'), 'NOEQUALS\n');
      await waitFor(async () => out.join('').includes('Could not load .env'));
      ok(out.join('').includes('Waiting for changes'));

      writeFileSync(join(app, '.env'), 'OHNE_TEST_GREETING=back\n');
      await waitFor(async () => (await getBody(port, '/greet')) === 'back');
    } finally {
      usePrinter().configure({ stream: process.stderr });
    }
  });

  it('drains a child mid-respawn when close is called before it is ready', TIMEOUT, async () => {
    const port = await freePort();
    const app = writeProject('close-race', port);
    writeRoute(app, 'health.ts');

    const out: string[] = [];
    useEnv().set('SILENT', false);
    usePrinter().configure({ stream: { write: (s) => out.push(s) } });
    try {
      const server = await dev(app, { entry: BIN, dashboard: false });
      servers.push(server);
      await waitFor(async () => (await get(port, '/health')) === 200);

      out.length = 0;
      writeRoute(app, 'users.get.ts');
      await waitFor(async () => out.join('').includes('Reloading API'));
      await server.close();

      let bound = false;
      const deadline = Date.now() + 1500;
      while (Date.now() < deadline && !bound) {
        if ((await get(port, '/health')) === 200) bound = true;
        else await delay(100);
      }
      strictEqual(bound, false);
    } finally {
      usePrinter().configure({ stream: process.stderr });
    }
  });

  it('settles on a "Waiting for changes" notice after a successful start', TIMEOUT, async () => {
    const port = await freePort();
    const app = writeProject('park', port);
    writeRoute(app, 'health.ts');

    const out: string[] = [];
    useEnv().set('SILENT', false);
    usePrinter().configure({ stream: { write: (s) => out.push(s) } });
    try {
      const server = await dev(app, { entry: BIN, dashboard: false });
      servers.push(server);
      await waitFor(async () => (await get(port, '/health')) === 200);
      ok(out.join('').includes('Waiting for changes'));
    } finally {
      usePrinter().configure({ stream: process.stderr });
    }
  });

  it('regenerates and reloads when a message catalog changes', TIMEOUT, async () => {
    const port = await freePort();
    const app = writeProject('messages', port);
    writeFileSync(
      join(app, 'api', 'lang.get.ts'),
      "import { useMessages } from 'ohnejs'\nexport default () => useMessages().get('en')?.greeting ?? 'missing'\n",
    );
    mkdirSync(join(app, 'messages'), { recursive: true });
    writeFileSync(join(app, 'messages', 'en.json'), JSON.stringify({ greeting: 'Hi' }));

    const server = await dev(app, { entry: BIN, dashboard: false });
    servers.push(server);

    await waitFor(async () => (await getBody(port, '/lang')) === 'Hi');

    writeFileSync(join(app, 'messages', 'en.json'), JSON.stringify({ greeting: 'Hello' }));
    await waitFor(async () => (await getBody(port, '/lang')) === 'Hello');
  });

  it('serves the dashboard alongside the API and injects the bound API URL', TIMEOUT, async () => {
    const dashPort = await freePort();
    const app = writeProject('with-dashboard', 0);
    writeFileSync(
      join(app, 'ohne.config.ts'),
      `export default { api: { port: 0 }, dashboard: { port: ${dashPort} }, printer: { silent: true } }\n`,
    );
    writeRoute(app, 'health.ts');

    const server = await dev(app, { entry: BIN });
    servers.push(server);

    await waitFor(async () => (await get(dashPort, '/')) === 200);

    const apiURL = (await getBody(dashPort, '/')).match(/"apiURL":"([^"]+)"/)?.[1] ?? '';
    ok(/^http:\/\/localhost:\d+$/.test(apiURL) && !apiURL.endsWith(':0'));
    const apiPort = Number(new URL(apiURL).port);
    await waitFor(async () => (await get(apiPort, '/health')) === 200);

    await server.close();
    await waitFor(async () => (await get(dashPort, '/')) === -1);
  });

  it('closes cleanly during a change cycle, spawning no child after close', TIMEOUT, async () => {
    const port = await freePort();
    const app = writeProject('close-cycle', port);
    const slowConfig =
      'await new Promise((resolve) => setTimeout(resolve, 700))\n' +
      `export default { api: { port: ${port} }, printer: { silent: true } }\n`;
    writeFileSync(join(app, 'ohne.config.ts'), slowConfig);
    writeRoute(app, 'health.ts');

    const server = await dev(app, { entry: BIN, dashboard: false });
    servers.push(server);
    await waitFor(async () => (await get(port, '/health')) === 200);

    writeFileSync(join(app, 'ohne.config.ts'), `${slowConfig}// touched\n`);
    await delay(300);
    await server.close();

    let bound = false;
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline && !bound) {
      if ((await get(port, '/health')) === 200) bound = true;
      else await delay(100);
    }
    strictEqual(bound, false);
  });

  it('parks quietly when a ready dashboard crashes, and a change revives it', TIMEOUT, async () => {
    const { app, cli, dashPort } = await startDev('dashboard-crashed');

    const mark = cli.output().length;
    process.kill(childPID('dashboard'), 'SIGUSR2');
    await waitFor(async () => cli.output().slice(mark).includes('Waiting for changes'));
    ok(!cli.output().slice(mark).includes('Dashboard stopped'));

    writeRoute(app, 'stormwind.get.ts');
    await waitFor(async () => cli.output().slice(mark).includes('Dashboard ready'));
    strictEqual(await get(dashPort, '/'), 200);
  });

  it('warns and restarts a dashboard stopped from outside', TIMEOUT, async () => {
    const { cli, dashPort } = await startDev('dashboard-killed');
    await delay(5_200);

    const mark = cli.output().length;
    process.kill(childPID('dashboard'), 'SIGKILL');
    await waitFor(async () => cli.output().slice(mark).includes('Dashboard ready'));
    const text = cli.output().slice(mark);
    ok(text.includes('Dashboard stopped by SIGKILL. Restarting...'));
    ok(/Dashboard ready[\s\S]*Waiting for changes/.test(text));
    strictEqual(await get(dashPort, '/'), 200);
  });

  it('restarts an API stopped from outside without a reload notice', TIMEOUT, async () => {
    const { cli, apiPort } = await startDev('api-stopped');
    await delay(5_200);

    const mark = cli.output().length;
    process.kill(childPID('api'), 'SIGTERM');
    await waitFor(async () => cli.output().slice(mark).includes('API ready'));
    const text = cli.output().slice(mark);
    ok(text.includes('API stopped. Restarting...'));
    ok(!text.includes('Reloading API'));
    strictEqual(await get(apiPort, '/health'), 200);
  });

  it('parks a child stopped right after it started, until a change', TIMEOUT, async () => {
    const { app, cli, apiPort } = await startDev('api-stopped-early');

    const mark = cli.output().length;
    process.kill(childPID('api'), 'SIGTERM');
    await waitFor(async () => cli.output().slice(mark).includes('Waiting for changes'));
    ok(cli.output().slice(mark).includes('API stopped right after it started.'));
    await delay(500);
    strictEqual(await get(apiPort, '/health'), -1);

    writeRoute(app, 'gnomeregan.get.ts');
    await waitFor(async () => (await get(apiPort, '/gnomeregan')) === 200);
  });

  it('prints only the child block when the dashboard cannot bind', TIMEOUT, async () => {
    const { app, cli, dashPort, apiPort } = await startDev('dashboard-busy');
    const holder = await holdDashboard(cli, dashPort);
    try {
      const mark = cli.output().length;
      writeRoute(app, 'orgrimmar.get.ts');
      await waitFor(async () =>
        /Another process is listening[\s\S]*Waiting for changes/.test(cli.output().slice(mark)),
      );
      const text = cli.output().slice(mark);
      ok(text.includes(`Port ${dashPort} is already in use`));
      ok(!cli.output().includes('Dashboard failed to start.'));
      ok(!cli.output().includes('did not signal ready'));
      strictEqual(await get(apiPort, '/orgrimmar'), 200);

      writeRoute(app, 'undercity.get.ts');
      await waitFor(async () => (await get(apiPort, '/undercity')) === 200, 5000);
    } finally {
      holder.close();
    }
  });

  it('retries a dashboard that could not bind on any later change', TIMEOUT, async () => {
    const { app, cli, dashPort } = await startDev('dashboard-retry');
    const holder = await holdDashboard(cli, dashPort);
    writeRoute(app, 'ironforge.get.ts');
    await waitFor(async () => cli.output().includes('Another process is listening'));
    await new Promise<void>((resolve) => holder.close(() => resolve()));

    const mark = cli.output().length;
    writeRoute(app, 'darnassus.get.ts');
    await waitFor(async () => cli.output().slice(mark).includes('Dashboard ready'));
    strictEqual(await get(dashPort, '/'), 200);
  });

  /**
   * Runs `dev` for an app whose `/origin` route answers the `DASHBOARD_URL` the API child got.
   * Returns the API URL the dashboard shell injects, and that origin.
   */
  async function devUnderHost(
    name: string,
    host: string,
  ): Promise<{ dashPort: number; apiURL: string; origin: string }> {
    const dashPort = await freePort();
    const app = writeProject(name, 0);
    writeFileSync(
      join(app, 'ohne.config.ts'),
      `export default { api: { port: 0 }, dashboard: { port: ${dashPort} }, printer: { silent: true } }\n`,
    );
    writeFileSync(
      join(app, 'api', 'origin.ts'),
      "import { useEnv } from 'ohnejs'\nexport default () => useEnv().get('DASHBOARD_URL')\n",
    );

    useEnv().set('HOST', host);
    try {
      const server = await dev(app, { entry: BIN });
      servers.push(server);
    } finally {
      useEnv().unset('HOST');
    }
    await waitFor(async () => (await get(dashPort, '/')) === 200);
    const apiURL = (await getBody(dashPort, '/')).match(/"apiURL":"([^"]+)"/)?.[1] ?? '';
    const origin = await getBody(Number(apiURL.match(/:(\d+)$/)?.[1]), '/origin');
    return { dashPort, apiURL, origin };
  }

  it('derives the API URL and the dashboard origin from the HOST override', TIMEOUT, async () => {
    const { dashPort, apiURL, origin } = await devUnderHost('dashboard-host', '127.0.0.1');
    ok(/^http:\/\/127\.0\.0\.1:\d+$/.test(apiURL));
    strictEqual(origin, `http://127.0.0.1:${dashPort}`);
  });

  it('brackets an IPv6 HOST override in both derived URLs', TIMEOUT, async () => {
    const { dashPort, apiURL, origin } = await devUnderHost('dashboard-ipv6', '::1');
    ok(/^http:\/\/\[::1\]:\d+$/.test(apiURL));
    strictEqual(origin, `http://[::1]:${dashPort}`);
  });

  it('restarts the dashboard when a config change stacks a new layer', TIMEOUT, async () => {
    const dashPort = await freePort();
    const app = writeProject('layer-added', 0);
    const config = (layers: string) =>
      `export default { ${layers}api: { port: 0 }, dashboard: { port: ${dashPort} }, printer: { silent: true } }\n`;
    writeFileSync(join(app, 'ohne.config.ts'), config(''));
    writeRoute(app, 'health.ts');

    const extra = join(app, 'node_modules', 'extra');
    mkdirSync(join(extra, 'dashboard', 'pages'), { recursive: true });
    writeFileSync(join(extra, 'package.json'), JSON.stringify({ name: 'extra', type: 'module' }));
    writeFileSync(join(extra, 'ohne.config.ts'), 'export default {}\n');
    writeFileSync(join(extra, 'dashboard', 'pages', 'extra.ts'), 'export default () => null\n');

    const server = await dev(app, { entry: BIN });
    servers.push(server);
    await waitFor(async () => (await get(dashPort, '/')) === 200);
    strictEqual(await get(dashPort, '/m/app/pages/extra.ts'), 404);

    writeFileSync(join(app, 'ohne.config.ts'), config("layers: ['extra'], "));
    await waitFor(async () => (await get(dashPort, '/m/app/pages/extra.ts')) === 200);
    ok((await getBody(dashPort, '/')).includes('/m/app/pages/extra.ts'));
  });

  it('honors a configured `dashboard.apiURL` over the derived URL', TIMEOUT, async () => {
    const dashPort = await freePort();
    const app = writeProject('dashboard-apiurl', 0);
    writeFileSync(
      join(app, 'ohne.config.ts'),
      `export default { api: { port: 0 }, dashboard: { port: ${dashPort}, apiURL: 'https://proxy.example/api' }, printer: { silent: true } }\n`,
    );

    const server = await dev(app, { entry: BIN });
    servers.push(server);

    await waitFor(async () => (await get(dashPort, '/')) === 200);

    const apiURL = (await getBody(dashPort, '/')).match(/"apiURL":"([^"]+)"/)?.[1] ?? '';
    strictEqual(apiURL, 'https://proxy.example/api');

    await server.close();
    await waitFor(async () => (await get(dashPort, '/')) === -1);
  });

  it('does not reload the API on a dashboard file change', TIMEOUT, async () => {
    const port = await freePort();
    const app = writeProject('dash-noreload', port);
    writeRoute(app, 'health.ts');

    const out: string[] = [];
    useEnv().set('SILENT', false);
    usePrinter().configure({ stream: { write: (s) => out.push(s) } });
    try {
      const server = await dev(app, { entry: BIN, dashboard: false });
      servers.push(server);
      await waitFor(async () => (await get(port, '/health')) === 200);
      await waitFor(async () => out.join('').includes('Waiting for changes'));
      out.length = 0;

      mkdirSync(join(app, 'dashboard', 'pages'), { recursive: true });
      writeFileSync(join(app, 'dashboard', 'pages', 'index.ts'), 'export default () => null\n');
      await new Promise((resolve) => setTimeout(resolve, 300));
      strictEqual(out.join('').includes('Reloading API'), false);
      strictEqual(await get(port, '/health'), 200);

      writeRoute(app, 'users.get.ts');
      await waitFor(async () => (await get(port, '/users')) === 200);
      ok(out.join('').includes('Reloading API'));
    } finally {
      usePrinter().configure({ stream: process.stderr });
    }
  });

  it('reloads the browser on a dashboard file change', TIMEOUT, async () => {
    const dashPort = await freePort();
    const app = writeProject('dash-reload', 0);
    writeFileSync(
      join(app, 'ohne.config.ts'),
      `export default { api: { port: 0 }, dashboard: { port: ${dashPort} }, printer: { silent: true } }\n`,
    );
    writeRoute(app, 'health.ts');
    mkdirSync(join(app, 'dashboard', 'pages'), { recursive: true });
    writeFileSync(join(app, 'dashboard', 'pages', 'index.ts'), 'export default () => null\n');

    const server = await dev(app, { entry: BIN });
    servers.push(server);
    await waitFor(async () => (await get(dashPort, '/')) === 200);

    const client = sseReload(dashPort, '/m/dashboard/reload');
    await client.connected;
    writeFileSync(join(app, 'dashboard', 'pages', 'about.ts'), 'export default () => null\n');
    await client.reloaded;
    client.close();
  });

  it(
    'reloads the browser only once the API the same batch respawns is ready',
    TIMEOUT,
    async () => {
      const dashPort = await freePort();
      const app = writeProject('dash-api-reload', 0);
      writeFileSync(
        join(app, 'ohne.config.ts'),
        `export default { api: { port: 0 }, dashboard: { port: ${dashPort} }, printer: { silent: true } }\n`,
      );
      writeRoute(app, 'health.ts');
      mkdirSync(join(app, 'dashboard', 'pages'), { recursive: true });
      writeFileSync(join(app, 'dashboard', 'pages', 'index.ts'), 'export default () => null\n');

      const server = await dev(app, { entry: BIN });
      servers.push(server);
      await waitFor(async () => (await get(dashPort, '/')) === 200);
      const apiPort = Number(
        new URL((await getBody(dashPort, '/')).match(/"apiURL":"([^"]+)"/)![1]).port,
      );
      await waitFor(async () => (await get(apiPort, '/health')) === 200);

      const client = sseReload(dashPort, '/m/dashboard/reload');
      await client.connected;
      writeFileSync(join(app, 'dashboard', 'pages', 'about.ts'), 'export default () => null\n');
      writeRoute(app, 'users.get.ts');
      await client.reloaded;
      client.close();
      strictEqual(await get(apiPort, '/users'), 200);
    },
  );

  it('does not reload the browser on an API-only change', TIMEOUT, async () => {
    const dashPort = await freePort();
    const app = writeProject('api-only-reload', 0);
    writeFileSync(
      join(app, 'ohne.config.ts'),
      `export default { api: { port: 0 }, dashboard: { port: ${dashPort} }, printer: { silent: true } }\n`,
    );
    writeRoute(app, 'health.ts');

    const server = await dev(app, { entry: BIN });
    servers.push(server);
    await waitFor(async () => (await get(dashPort, '/')) === 200);
    const apiPort = Number(
      new URL((await getBody(dashPort, '/')).match(/"apiURL":"([^"]+)"/)![1]).port,
    );

    const client = sseReload(dashPort, '/m/dashboard/reload');
    await client.connected;
    let reloaded = false;
    void client.reloaded.then(() => (reloaded = true));

    writeRoute(app, 'users.get.ts');
    await waitFor(async () => (await get(apiPort, '/users')) === 200);
    await new Promise((resolve) => setTimeout(resolve, 100));
    client.close();
    strictEqual(reloaded, false);
  });
});

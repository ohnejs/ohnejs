import { ok, strictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { dev, type DevServer } from '../../../src/ohne/dev/supervisor.ts';
import { useEnv, useLayers, usePrinter, useShutdown } from '../../../src/ohne/index.ts';

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

describe('dev', () => {
  let root: string;
  let servers: DevServer[];

  function writeProject(name: string, port: number, silent = true): string {
    const app = join(root, name);
    mkdirSync(join(app, 'api'), { recursive: true });
    mkdirSync(join(app, 'node_modules'), { recursive: true });
    symlinkSync(REPO, join(app, 'node_modules', 'ohne'), 'dir');
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

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'ohne-supervisor-'));
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  beforeEach(() => {
    servers = [];
  });

  afterEach(async () => {
    for (const server of servers) await server.close();
    useShutdown().unwatch();
    useShutdown().clear();
    useLayers().clear();
    useEnv().unset('SILENT');
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

  it('drains a child mid-respawn when close is called before it is ready', TIMEOUT, async () => {
    const port = await freePort();
    const app = writeProject('close-race', port);
    writeRoute(app, 'health.ts');

    const out: string[] = [];
    useEnv().set('SILENT', false);
    usePrinter().configure({ color: false, stream: { write: (s) => out.push(s) } });
    try {
      const server = await dev(app, { entry: BIN, dashboard: false });
      servers.push(server);
      await waitFor(async () => (await get(port, '/health')) === 200);

      // Trigger a reload, then close the instant the respawn begins - before the new child is ready.
      out.length = 0;
      writeRoute(app, 'users.get.ts');
      await waitFor(async () => out.join('').includes('Reloading API'));
      await server.close();

      // The respawning child must have been drained: nothing binds the port, even after it would boot.
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

    // Capture the in-process supervisor's printer; the child serves in a separate process.
    const out: string[] = [];
    useEnv().set('SILENT', false);
    usePrinter().configure({ color: false, stream: { write: (s) => out.push(s) } });
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
      "import { useMessages } from 'ohne'\nexport default () => useMessages().get('en')?.greeting ?? 'missing'\n",
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

    // A config change opens a slow regen; closing inside it must not respawn afterwards.
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

  it('prints one supervisor-owned line when the dashboard child fails boot', TIMEOUT, async () => {
    const dashPort = await freePort();
    const app = writeProject('dashboard-boot-fail', 0);
    writeFileSync(
      join(app, 'ohne.config.ts'),
      `export default { api: { port: 0 }, dashboard: { port: ${dashPort} }, ` +
        `messages: { defaultLanguage: 'not a tag!' }, printer: { silent: true } }\n`,
    );
    writeRoute(app, 'health.ts');

    const out: string[] = [];
    useEnv().set('SILENT', false);
    usePrinter().configure({ color: false, stream: { write: (s) => out.push(s) } });
    try {
      const server = await dev(app, { entry: BIN });
      servers.push(server);
      const text = out.join('');
      ok(text.includes('Dashboard failed to start.'));
      ok(!text.includes('exited before ready'));
    } finally {
      usePrinter().configure({ stream: process.stderr });
    }
  });

  it(
    'derives the dashboard API URL from the HOST override the api child binds',
    TIMEOUT,
    async () => {
      const dashPort = await freePort();
      const app = writeProject('dashboard-host', 0);
      writeFileSync(
        join(app, 'ohne.config.ts'),
        `export default { api: { port: 0 }, dashboard: { port: ${dashPort} }, printer: { silent: true } }\n`,
      );
      writeRoute(app, 'health.ts');

      useEnv().set('HOST', '127.0.0.1');
      try {
        const server = await dev(app, { entry: BIN });
        servers.push(server);

        await waitFor(async () => (await get(dashPort, '/')) === 200);
        const apiURL = (await getBody(dashPort, '/')).match(/"apiURL":"([^"]+)"/)?.[1] ?? '';
        ok(/^http:\/\/127\.0\.0\.1:\d+$/.test(apiURL));
      } finally {
        useEnv().unset('HOST');
      }
    },
  );

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
    usePrinter().configure({ color: false, stream: { write: (s) => out.push(s) } });
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

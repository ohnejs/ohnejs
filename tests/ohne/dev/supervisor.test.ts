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
      `export default { server: { port: ${port} }, printer: { silent: ${silent} } }\n`,
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

    const server = await dev(app, { entry: BIN });
    servers.push(server);

    await waitFor(async () => (await get(port, '/health')) === 200);
    strictEqual(await get(port, '/users'), 404);

    writeRoute(app, 'users.get.ts');
    await waitFor(async () => (await get(port, '/users')) === 200);

    await server.close();
    await waitFor(async () => (await get(port, '/health')) === -1);
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
      const server = await dev(app, { entry: BIN });
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

    const server = await dev(app, { entry: BIN });
    servers.push(server);

    await waitFor(async () => (await getBody(port, '/lang')) === 'Hi');

    writeFileSync(join(app, 'messages', 'en.json'), JSON.stringify({ greeting: 'Hello' }));
    await waitFor(async () => (await getBody(port, '/lang')) === 'Hello');
  });
});

import type { AddressInfo } from 'node:net';

import { strictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';

import {
  type HTTPServer,
  serveAPI,
  shutdownServer,
  useEnv,
  useMiddleware,
  useShutdown,
} from '../../../src/ohne/index.ts';

const FRAMEWORK = join(import.meta.dirname, '..', '..', '..');
const ORIGIN = 'http://dash.example';

interface Res {
  status: number;
  headers: Record<string, string | string[] | undefined>;
}

function req(
  port: number,
  method: string,
  path: string,
  headers: Record<string, string>,
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const r = request(
      { host: 'localhost', port, method, path, headers: { connection: 'close', ...headers } },
      (res) => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers }));
      },
    );
    r.on('error', reject);
    r.end();
  });
}

describe('serveAPI CORS', () => {
  let root: string;
  let http: HTTPServer | undefined;

  function serveable(name: string, corsOrigin?: string): string {
    const dir = mkdtempSync(join(root, `${name}-`));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, type: 'module' }));
    writeFileSync(join(dir, 'ohne.config.ts'), '');
    mkdirSync(join(dir, 'node_modules'));
    symlinkSync(FRAMEWORK, join(dir, 'node_modules', 'ohne'), 'dir');
    mkdirSync(join(dir, 'api'));
    writeFileSync(
      join(dir, 'api', 'ping.get.ts'),
      "import { defineHandler } from 'ohne';\nexport default defineHandler(() => 'pong');\n",
    );
    if (corsOrigin !== undefined) {
      mkdirSync(join(dir, 'middleware', 'global'), { recursive: true });
      writeFileSync(
        join(dir, 'middleware', 'global', 'cors.ts'),
        `import { cors } from 'ohne';\nexport default cors({ origin: '${corsOrigin}' });\n`,
      );
    }
    return dir;
  }

  async function serve(name: string, corsOrigin?: string): Promise<number> {
    http = await serveAPI(serveable(name, corsOrigin));
    return (http.server.address() as AddressInfo).port;
  }

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'ohne-cors-'));
    useEnv().set('SILENT', true);
    useEnv().set('PORT', 0);
  });

  afterEach(async () => {
    if (http) await shutdownServer(http.server, http.gate);
    http = undefined;
    useShutdown().clear();
    useShutdown().unwatch();
    useMiddleware().clear();
  });

  after(() => {
    useEnv().unset('SILENT');
    useEnv().unset('PORT');
    rmSync(root, { recursive: true, force: true });
  });

  it('allows any origin, without credentials, by default', async () => {
    const res = await req(await serve('default'), 'GET', '/ping', { origin: ORIGIN });
    strictEqual(res.headers['access-control-allow-origin'], '*');
    strictEqual(res.headers['access-control-allow-credentials'], undefined);
  });

  it('applies the default even to a 404, which never enters dispatch', async () => {
    const res = await req(await serve('miss'), 'GET', '/nope', { origin: ORIGIN });
    strictEqual(res.status, 404);
    strictEqual(res.headers['access-control-allow-origin'], '*');
  });

  it('answers the preflight OPTIONS with 204 and the allowed methods', async () => {
    const res = await req(await serve('preflight'), 'OPTIONS', '/ping', {
      origin: ORIGIN,
      'access-control-request-method': 'GET',
    });
    strictEqual(res.status, 204);
    strictEqual(res.headers['access-control-allow-methods'], '*');
    strictEqual(res.headers['access-control-allow-headers'], '*');
  });

  it('lets a mounted cors policy replace the default', async () => {
    const port = await serve('override', ORIGIN);

    const allowed = await req(port, 'GET', '/ping', { origin: ORIGIN });
    strictEqual(allowed.headers['access-control-allow-origin'], ORIGIN);

    const denied = await req(port, 'GET', '/ping', { origin: 'http://evil.example' });
    strictEqual(denied.headers['access-control-allow-origin'], undefined);
  });
});

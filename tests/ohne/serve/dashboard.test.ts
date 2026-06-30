import type { AddressInfo } from 'node:net';

import { rejects, strictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';

import {
  type HTTPServer,
  serveDashboard,
  shutdownServer,
  useEnv,
  useShutdown,
} from '../../../src/ohne/index.ts';

interface Res {
  status: number;
  body: string;
  headers: Record<string, string | string[] | undefined>;
}

function req(port: number, path: string, headers: Record<string, string> = {}): Promise<Res> {
  return new Promise((resolve, reject) => {
    const r = request(
      { host: 'localhost', port, path, headers: { connection: 'close', ...headers } },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
      },
    );
    r.on('error', reject);
    r.end();
  });
}

describe('serveDashboard', () => {
  let root: string;
  let http: HTTPServer | undefined;

  function makeApp(name: string): string {
    const dir = mkdtempSync(join(root, `${name}-`));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, type: 'module' }));
    writeFileSync(join(dir, 'ohne.config.ts'), '');
    return dir;
  }

  async function serve(name: string): Promise<number> {
    http = await serveDashboard(makeApp(name));
    return (http.server.address() as AddressInfo).port;
  }

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'ohne-serve-dashboard-'));
    useEnv().set('SILENT', true);
    useEnv().set('PORT', 0);
  });

  afterEach(async () => {
    if (http) await shutdownServer(http.server, http.gate);
    http = undefined;
    useShutdown().clear();
    useShutdown().unwatch();
  });

  after(() => {
    useEnv().unset('SILENT');
    useEnv().unset('PORT');
    rmSync(root, { recursive: true, force: true });
  });

  it('serves the single-page shell at the root', async () => {
    const port = await serve('shell');
    const res = await req(port, '/');
    strictEqual(res.status, 200);
    strictEqual(res.headers['content-type'], 'text/html; charset=utf-8');
    strictEqual(res.body.includes('id="app"'), true);
  });

  it('serves the shell for an unknown navigation path, as a pure SPA', async () => {
    const port = await serve('spa');
    const res = await req(port, '/users/42');
    strictEqual(res.status, 200);
    strictEqual(res.headers['content-type'], 'text/html; charset=utf-8');
  });

  it('serves a kernel module type-stripped as JavaScript', async () => {
    const port = await serve('kernel');
    const res = await req(port, '/m/dashboard/index.ts');
    strictEqual(res.status, 200);
    strictEqual(res.headers['content-type'], 'text/javascript; charset=utf-8');
    strictEqual(res.body.includes('export { h }'), true);
    strictEqual(res.body.includes('export type'), false);
  });

  it('serves an imported utils module, so the graph resolves', async () => {
    const port = await serve('utils');
    const res = await req(port, '/m/utils/reactive/ref.ts');
    strictEqual(res.status, 200);
    strictEqual(res.headers['content-type'], 'text/javascript; charset=utf-8');
  });

  it('does not serve the Node framework source outside the browser subtrees', async () => {
    const port = await serve('confined');
    strictEqual((await req(port, '/m/ohne/serve/dashboard.ts')).status, 404);
    strictEqual((await req(port, '/m/layer/api/messages/[group]/[language].get.ts')).status, 404);
  });

  it('answers a missing module with 404', async () => {
    const port = await serve('missing');
    strictEqual((await req(port, '/m/dashboard/nope.ts')).status, 404);
  });

  it('answers a directory path with 404, not 500', async () => {
    const port = await serve('directory');
    strictEqual((await req(port, '/m/dashboard')).status, 404);
  });

  it('blocks path traversal out of the module root', async () => {
    const port = await serve('traversal');
    strictEqual((await req(port, '/m/%2Fetc%2Fpasswd')).status, 404);
  });

  it('answers 304 when the client ETag matches', async () => {
    const port = await serve('etag');
    const first = await req(port, '/m/dashboard/index.ts');
    const etag = first.headers['etag'];
    strictEqual(typeof etag, 'string');
    const second = await req(port, '/m/dashboard/index.ts', { 'if-none-match': etag as string });
    strictEqual(second.status, 304);
  });

  it('rejects a port outside 0-65535', async () => {
    useEnv().set('PORT', 99999);
    await rejects(() => serveDashboard(makeApp('badport')), /Invalid dashboard port/);
    useEnv().set('PORT', 0);
  });

  it('injects the API base URL derived from the API config', async () => {
    const port = await serve('apiurl-derived');
    const res = await req(port, '/');
    strictEqual(res.body.includes('"apiURL":"http://localhost:9001"'), true);
  });

  it('normalizes a slash-forgiving `basePath` in the derived API URL', async () => {
    const dir = makeApp('apiurl-basepath');
    writeFileSync(join(dir, 'ohne.config.ts'), "export default { api: { basePath: 'api' } }\n");
    http = await serveDashboard(dir);
    const port = (http.server.address() as AddressInfo).port;
    strictEqual((await req(port, '/')).body.includes('"apiURL":"http://localhost:9001/api"'), true);
  });

  it('lets `Config.dashboard.apiURL` override the derived API URL', async () => {
    const dir = makeApp('apiurl-config');
    writeFileSync(
      join(dir, 'ohne.config.ts'),
      "export default { dashboard: { apiURL: 'https://api.example.test' } }\n",
    );
    http = await serveDashboard(dir);
    const port = (http.server.address() as AddressInfo).port;
    strictEqual((await req(port, '/')).body.includes('"apiURL":"https://api.example.test"'), true);
  });

  it('lets the `API_URL` env override the config and the derived URL', async () => {
    useEnv().set('API_URL', 'http://localhost:7777');
    try {
      const port = await serve('apiurl-env');
      strictEqual((await req(port, '/')).body.includes('"apiURL":"http://localhost:7777"'), true);
    } finally {
      useEnv().unset('API_URL');
    }
  });

  it('injects an importmap mapping the bare specifiers to served URLs', async () => {
    const port = await serve('importmap');
    const body = (await req(port, '/')).body;
    strictEqual(body.includes('<script type="importmap">'), true);
    strictEqual(body.includes('"ohne/dashboard":"/m/dashboard/index.ts"'), true);
    strictEqual(body.includes('"ohne/utils":"/m/utils/index.ts"'), true);
    strictEqual(body.includes('"app/":"/m/app/"'), true);
  });

  it('references the boot module entry from the shell', async () => {
    const port = await serve('boot');
    strictEqual(
      (await req(port, '/')).body.includes('<script type="module" src="/m/dashboard/boot.ts">'),
      true,
    );
  });

  it('lists a page in the manifest and serves its module under /m/app', async () => {
    const dir = makeApp('app-pages');
    const file = join(dir, 'dashboard', 'pages', 'users', '[id].ts');
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, 'export default () => null\n');
    http = await serveDashboard(dir);
    const port = (http.server.address() as AddressInfo).port;

    strictEqual((await req(port, '/')).body.includes('"url":"/m/app/pages/users/[id].ts"'), true);

    const mod = await req(port, '/m/app/pages/users/[id].ts');
    strictEqual(mod.status, 200);
    strictEqual(mod.headers['content-type'], 'text/javascript; charset=utf-8');
  });

  it('blocks path traversal out of the app module root', async () => {
    const port = await serve('app-traversal');
    strictEqual((await req(port, '/m/app/%2Fetc%2Fpasswd')).status, 404);
  });
});

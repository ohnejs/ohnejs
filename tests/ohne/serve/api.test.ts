import type { AddressInfo } from 'node:net';

import { rejects, strictEqual } from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';

import {
  type HTTPServer,
  serveAPI,
  shutdownServer,
  useEnv,
  useShutdown,
} from '../../../src/ohne/index.ts';

const scope = globalThis as typeof globalThis & { __ohneServeBoot: string[] };

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

describe('serveAPI', () => {
  let root: string;
  let http: HTTPServer | undefined;

  function makeApp(name: string, mark: string): string {
    const dir = mkdtempSync(join(root, `${name}-`));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name }));
    writeFileSync(join(dir, 'ohne.config.ts'), '');
    mkdirSync(join(dir, 'boot'));
    writeFileSync(
      join(dir, 'boot', 'index.ts'),
      `globalThis.__ohneServeBoot.push(${JSON.stringify(mark)})\n`,
    );
    return dir;
  }

  // An app whose generated files can resolve the bare `ohne` import, with one route to dispatch.
  function serveable(name: string): string {
    const dir = makeApp(name, `${name}:boot`);
    mkdirSync(join(dir, 'node_modules'));
    symlinkSync(FRAMEWORK, join(dir, 'node_modules', 'ohne'), 'dir');
    mkdirSync(join(dir, 'api'));
    writeFileSync(
      join(dir, 'api', 'ping.get.ts'),
      "import { defineHandler } from 'ohne';\nexport default defineHandler(() => 'pong');\n",
    );
    return dir;
  }

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'ohne-serve-api-'));
    scope.__ohneServeBoot = [];
    useEnv().set('SILENT', true);
    useEnv().set('PORT', 0);
  });

  afterEach(async () => {
    if (http) await shutdownServer(http.server, http.gate);
    http = undefined;
    useShutdown().clear();
    useShutdown().unwatch();
    useEnv().unset('SKIP_CODEGEN');
  });

  after(() => {
    useEnv().unset('SILENT');
    useEnv().unset('PORT');
    rmSync(root, { recursive: true, force: true });
  });

  it('boots the layers, then generates the codegen files', async () => {
    const dir = makeApp('app', 'app:boot');

    http = await serveAPI(dir);

    strictEqual(scope.__ohneServeBoot.includes('app:boot'), true);
    strictEqual(existsSync(join(dir, '.ohne', 'layer-name.ts')), true);
    strictEqual(existsSync(join(dir, '.ohne', 'resolved-config.ts')), true);
  });

  it('boots but skips codegen when `SKIP_CODEGEN` is set', async () => {
    const dir = makeApp('skip', 'skip:boot');
    useEnv().set('SKIP_CODEGEN', true);

    http = await serveAPI(dir);

    strictEqual(scope.__ohneServeBoot.includes('skip:boot'), true);
    strictEqual(existsSync(join(dir, '.ohne')), false);
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
      "import { defineMiddleware } from 'ohne';\n" +
        'export default defineMiddleware((event) => {\n' +
        "  event.response.headers.set('x-mw', 'ran');\n" +
        '});\n',
    );

    http = await serveAPI(dir);
    const { port } = http.server.address() as AddressInfo;

    strictEqual(await get(port, '/ping'), 200);
    strictEqual(await header(port, '/ping', 'x-mw'), 'ran');
  });

  it('rejects a port outside 0-65535', async () => {
    const dir = makeApp('badport', 'badport:boot');
    useEnv().set('PORT', 99999);

    await rejects(() => serveAPI(dir), /Invalid server port/);

    useEnv().set('PORT', 0);
  });
});

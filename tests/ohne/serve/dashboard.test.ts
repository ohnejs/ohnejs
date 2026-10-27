import type { AddressInfo } from 'node:net';

import { deepStrictEqual, match, notStrictEqual, rejects, strictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';

import {
  type HTTPServer,
  serveDashboard,
  shutdownServer,
  useEnv,
  usePrinter,
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

/**
 * The `imports` of the importmap a shell document carries.
 */
function importsOf(body: string): Record<string, string> {
  const map = /<script type="importmap">(.*?)<\/script>/s.exec(body)?.[1] ?? '{}';
  return (JSON.parse(map) as { imports: Record<string, string> }).imports;
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

  function writeBoot(dir: string, name: string, mark: string): void {
    const file = join(dir, 'dashboard', 'boot', name);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, `export const mark = ${JSON.stringify(mark)};\n`);
  }

  function captureWarnings(): string[] {
    const buf: string[] = [];
    useEnv().set('NO_COLOR', true);
    usePrinter().configure({ stream: { write: (s: string) => buf.push(s) }, color: false });
    useEnv().unset('SILENT');
    useEnv().unset('DATABASE');
    return buf;
  }

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'ohne-serve-dashboard-'));
    useEnv().set('SILENT', true);
    useEnv().set('DATABASE', ':memory:');
    useEnv().set('PORT', 0);
  });

  afterEach(async () => {
    if (http) await shutdownServer(http.server, http.gate);
    http = undefined;
    useShutdown().clear();
    useShutdown().unwatch();
    useEnv().unset('DASHBOARD_RELOAD');
    useEnv().unset('NO_COLOR');
    useEnv().set('SILENT', true);
    useEnv().set('DATABASE', ':memory:');
    usePrinter().configure({ stream: process.stderr });
  });

  after(() => {
    useEnv().unset('SILENT');
    useEnv().unset('DATABASE');
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

  it('refuses to be framed by any page', async () => {
    const port = await serve('frame');
    const res = await req(port, '/collections/pages');
    strictEqual(res.headers['content-security-policy'], "frame-ancestors 'none'");
  });

  it('lets only the listed origins frame it', async () => {
    const dir = makeApp('frame-allow');
    writeFileSync(
      join(dir, 'ohne.config.ts'),
      "export default { dashboard: { frameAncestors: ['https://ohne.dev', 'http://localhost:3000'] } };",
    );
    http = await serveDashboard(dir);
    const port = (http.server.address() as AddressInfo).port;
    const policy = 'frame-ancestors https://ohne.dev http://localhost:3000';
    strictEqual((await req(port, '/')).headers['content-security-policy'], policy);
    strictEqual((await req(port, '/collections/pages')).headers['content-security-policy'], policy);
  });

  it('refuses framing when the list is empty', async () => {
    const dir = makeApp('frame-empty');
    writeFileSync(
      join(dir, 'ohne.config.ts'),
      'export default { dashboard: { frameAncestors: [] } };',
    );
    http = await serveDashboard(dir);
    const res = await req((http.server.address() as AddressInfo).port, '/');
    strictEqual(res.headers['content-security-policy'], "frame-ancestors 'none'");
  });

  it("never inherits a stacked layer's frame ancestors", async () => {
    const base = makeApp('frame-base');
    writeFileSync(
      join(base, 'ohne.config.ts'),
      "export default { dashboard: { frameAncestors: ['https://evil.example'] } };",
    );
    const dir = makeApp('frame-app');
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'app', type: 'module', dependencies: { base: '*' } }),
    );
    writeFileSync(join(dir, 'ohne.config.ts'), "export default { layers: ['base'] }\n");
    mkdirSync(join(dir, 'node_modules'));
    symlinkSync(base, join(dir, 'node_modules', 'base'), 'dir');
    http = await serveDashboard(dir);
    const res = await req((http.server.address() as AddressInfo).port, '/');
    strictEqual(res.headers['content-security-policy'], "frame-ancestors 'none'");
  });

  it('refuses to boot with an invalid frame ancestor', async () => {
    const dir = makeApp('frame-invalid');
    writeFileSync(
      join(dir, 'ohne.config.ts'),
      "export default { dashboard: { frameAncestors: ['https://*.ohne.dev'] } };",
    );
    await rejects(serveDashboard(dir), /Invalid frame ancestor/);
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
    strictEqual((await req(port, '/m/base/api/messages/[group]/[language].get.ts')).status, 404);
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

  it('injects the canonicalized `messages.defaultLanguage`', async () => {
    const dir = makeApp('language');
    writeFileSync(
      join(dir, 'ohne.config.ts'),
      "export default { messages: { defaultLanguage: 'de-at' } }\n",
    );
    http = await serveDashboard(dir);
    const port = (http.server.address() as AddressInfo).port;
    strictEqual((await req(port, '/')).body.includes('"defaultLanguage":"de-AT"'), true);
  });

  it('injects every enabled message group once', async () => {
    const dir = makeApp('groups');
    writeFileSync(
      join(dir, 'ohne.config.ts'),
      "export default { disable: { messages: ['draft.**'] } }\n",
    );
    mkdirSync(join(dir, 'messages', 'api'), { recursive: true });
    writeFileSync(
      join(dir, 'messages', 'en.json'),
      JSON.stringify({ nav: { home: 'Home' }, draft: { note: 'Note' } }),
    );
    writeFileSync(join(dir, 'messages', 'de.json'), JSON.stringify({ nav: { home: 'Start' } }));
    writeFileSync(join(dir, 'messages', 'api', 'de.json'), JSON.stringify({ gone: 'Weg' }));
    http = await serveDashboard(dir);
    const port = (http.server.address() as AddressInfo).port;
    strictEqual((await req(port, '/')).body.includes('"messageGroups":["api","nav"]'), true);
  });

  it('rejects an invalid `messages.defaultLanguage`', async () => {
    const dir = makeApp('badlanguage');
    writeFileSync(
      join(dir, 'ohne.config.ts'),
      "export default { messages: { defaultLanguage: 'en_US' } }\n",
    );
    await rejects(() => serveDashboard(dir), /Invalid default language/);
  });

  it('maps the bare specifiers straight to fingerprinted URLs', async () => {
    const port = await serve('importmap');
    const imports = importsOf((await req(port, '/')).body);
    match(imports['ohnejs/dashboard'] ?? '', /^\/m\/dashboard\/index\.ts\?h=[\w-]{8}$/);
    strictEqual(imports['ohnejs/dashboard'], imports['/m/dashboard/index.ts']);
    match(imports['ohnejs/utils'] ?? '', /^\/m\/utils\/index\.ts\?h=[\w-]{8}$/);
    strictEqual(imports['ohnejs/utils'], imports['/m/utils/index.ts']);
    strictEqual(imports['app/'], '/m/app/');
  });

  it('maps every kernel module to its fingerprinted URL', async () => {
    const port = await serve('importmap-kernel');
    const imports = importsOf((await req(port, '/')).body);
    match(imports['/m/utils/reactive/ref.ts'] ?? '', /^\/m\/utils\/reactive\/ref\.ts\?h=[\w-]{8}$/);
    match(imports['/m/dashboard/router/router.ts'] ?? '', /\?h=[\w-]{8}$/);
  });

  it('gives a layer module one fingerprinted URL, bare or relative', async () => {
    const dir = makeApp('importmap-app');
    writeBoot(dir, 'slots.ts', 'app:slots');
    http = await serveDashboard(dir);
    const imports = importsOf((await req((http.server.address() as AddressInfo).port, '/')).body);
    match(imports['/m/app/boot/slots.ts'] ?? '', /^\/m\/app\/boot\/slots\.ts\?h=[\w-]{8}$/);
    strictEqual(imports['app/boot/slots.ts'], imports['/m/app/boot/slots.ts']);
  });

  it('loads the kernel entry from its fingerprinted URL', async () => {
    const port = await serve('boot');
    const body = (await req(port, '/')).body;
    const src = importsOf(body)['/m/dashboard/boot.ts'];
    match(src ?? '', /\?h=[\w-]{8}$/);
    strictEqual(body.includes(`<script type="module" src="${src}" id="ohne-boot">`), true);
  });

  it('preloads the graph the kernel entry reaches, after the importmap', async () => {
    const port = await serve('preload');
    const body = (await req(port, '/')).body;
    const imports = importsOf(body);
    const preloads = [...body.matchAll(/<link rel="modulepreload" href="([^"]+)" \/>/g)].map(
      (match) => match[1],
    );
    strictEqual(preloads[0], imports['/m/dashboard/boot.ts']);
    strictEqual(preloads.includes(imports['/m/dashboard/router/router.ts'] ?? ''), true);
    strictEqual(preloads.includes(imports['/m/utils/reactive/ref.ts'] ?? ''), true);
    strictEqual(new Set(preloads).size, preloads.length);
    for (const href of preloads) match(href ?? '', /\?h=[\w-]{8}$/);

    const links = body.indexOf('<link rel="modulepreload"');
    strictEqual(body.indexOf('<script type="importmap">') < links, true);
    strictEqual(links < body.indexOf('id="ohne-boot"'), true);
  });

  it('preloads the layer modules boot files and pages reach, and only those', async () => {
    const dir = makeApp('preload-app');
    writeBoot(dir, 'theme.ts', 'app:theme');
    const files = {
      'boot/fields.ts': "import { field } from '../components/field.ts';\nexport { field };\n",
      'components/field.ts': "import 'app/components/shared.ts';\nexport const field = 1;\n",
      'components/shared.ts': 'export {};\n',
      'components/unused.ts': 'export {};\n',
      'pages/home.ts': "export default () => import('./lazy.ts');\n",
      'pages/lazy.ts': 'export {};\n',
    };
    for (const [path, source] of Object.entries(files)) {
      mkdirSync(join(dir, 'dashboard', path, '..'), { recursive: true });
      writeFileSync(join(dir, 'dashboard', path), source);
    }
    http = await serveDashboard(dir);
    const body = (await req((http.server.address() as AddressInfo).port, '/')).body;
    const imports = importsOf(body);
    const preloaded = (path: string): boolean =>
      body.includes(`<link rel="modulepreload" href="${imports[`/m/app/${path}`]}" />`);

    for (const path of ['boot/theme.ts', 'boot/fields.ts', 'components/field.ts']) {
      strictEqual(preloaded(path), true, path);
    }
    strictEqual(preloaded('components/shared.ts'), true);
    strictEqual(preloaded('pages/home.ts'), true);
    strictEqual(preloaded('pages/lazy.ts'), true);
    strictEqual(preloaded('components/unused.ts'), false);
  });

  it('caches a module for good at its fingerprinted URL', async () => {
    const port = await serve('immutable');
    const url = importsOf((await req(port, '/')).body)['/m/dashboard/index.ts'] ?? '';
    const res = await req(port, url);
    strictEqual(res.status, 200);
    strictEqual(res.headers['cache-control'], 'public, max-age=31536000, immutable');
    strictEqual(res.headers['etag'], `"${url.split('?h=')[1]}"`);
  });

  it('revalidates a module at its plain or a stale URL, with the current bytes', async () => {
    const port = await serve('revalidate');
    const url = importsOf((await req(port, '/')).body)['/m/dashboard/index.ts'] ?? '';
    const current = await req(port, url);
    for (const path of ['/m/dashboard/index.ts', '/m/dashboard/index.ts?h=AAAAAAAA']) {
      const res = await req(port, path);
      strictEqual(res.headers['cache-control'], 'no-cache');
      strictEqual(res.headers['etag'], current.headers['etag']);
      strictEqual(res.body, current.body);
    }
  });

  it('caches a page module with brackets in its path for good', async () => {
    const dir = makeApp('immutable-page');
    const file = join(dir, 'dashboard', 'pages', 'users', '[id].ts');
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, 'export default () => null\n');
    http = await serveDashboard(dir);
    const port = (http.server.address() as AddressInfo).port;
    const url = importsOf((await req(port, '/')).body)['app/pages/users/[id].ts'] ?? '';
    match(url, /^\/m\/app\/pages\/users\/\[id\]\.ts\?h=[\w-]{8}$/);
    strictEqual(
      (await req(port, url)).headers['cache-control'],
      'public, max-age=31536000, immutable',
    );
  });

  it('names an edited module by its new bytes on the next render, with no restart', async () => {
    const dir = makeApp('edit');
    writeBoot(dir, 'theme.ts', 'app:old');
    http = await serveDashboard(dir);
    const port = (http.server.address() as AddressInfo).port;
    const before = importsOf((await req(port, '/')).body)['/m/app/boot/theme.ts'] ?? '';

    writeBoot(dir, 'theme.ts', 'app:newer');
    const after = importsOf((await req(port, '/')).body)['/m/app/boot/theme.ts'] ?? '';
    notStrictEqual(after, before);

    const stale = await req(port, before);
    strictEqual(stale.headers['cache-control'], 'no-cache');
    strictEqual(stale.body.includes('app:newer'), true);
    strictEqual(
      (await req(port, after)).headers['cache-control'],
      'public, max-age=31536000, immutable',
    );
  });

  it('has the shell revalidated, and answers 304 while it is unchanged', async () => {
    const dir = makeApp('shell-cache');
    writeBoot(dir, 'theme.ts', 'app:old');
    http = await serveDashboard(dir);
    const port = (http.server.address() as AddressInfo).port;
    const first = await req(port, '/');
    strictEqual(first.headers['cache-control'], 'no-cache');
    const etag = first.headers['etag'] as string;
    strictEqual((await req(port, '/', { 'if-none-match': etag })).status, 304);

    writeBoot(dir, 'theme.ts', 'app:newer');
    const edited = await req(port, '/', { 'if-none-match': etag });
    strictEqual(edited.status, 200);
    notStrictEqual(edited.headers['etag'], etag);
  });

  it('maps a kernel font to its fingerprinted URL and caches it there for good', async () => {
    const port = await serve('font');
    const path = '/m/dashboard/assets/fonts/fira-mono-cyrillic-400.woff2';
    const url = importsOf((await req(port, '/')).body)[path] ?? '';
    match(url, /\?h=[\w-]{8}$/);
    const res = await req(port, url);
    strictEqual(res.status, 200);
    strictEqual(res.headers['content-type'], 'font/woff2');
    strictEqual(res.headers['cache-control'], 'public, max-age=31536000, immutable');
    strictEqual((await req(port, path)).headers['cache-control'], 'no-cache');
  });

  it('serves any other file as is, revalidated against its stats', async () => {
    const port = await serve('asset');
    const res = await req(port, '/m/dashboard/tsconfig.json');
    strictEqual(res.status, 200);
    strictEqual(res.headers['cache-control'], 'no-cache');
    match(res.headers['etag'] as string, /^W\//);
  });

  it('reloads once over a failed boot, under the mark the router shares', async () => {
    const port = await serve('boot-reload');
    const body = (await req(port, '/')).body;
    strictEqual(body.includes("sessionStorage.setItem('ohne-reloaded', '1');"), true);
    strictEqual(body.includes("sessionStorage.removeItem('ohne-reloaded');"), true);
  });

  it('holds a boot failure state in English when no catalog translates it', async () => {
    const port = await serve('boot-failed');
    const body = (await req(port, '/')).body;
    strictEqual(body.includes('<template id="ohne-boot-failed">'), true);
    strictEqual(body.includes('<p>Failed to load</p>'), true);
    strictEqual(body.includes('<button type="button" class="ohne-raw">Retry</button>'), true);
  });

  it('translates the boot failure state down the default language chain', async () => {
    const dir = makeApp('boot-failed-de');
    writeFileSync(
      join(dir, 'ohne.config.ts'),
      "export default { messages: { defaultLanguage: 'de-AT' } }\n",
    );
    mkdirSync(join(dir, 'messages', 'dashboard'), { recursive: true });
    writeFileSync(
      join(dir, 'messages', 'dashboard', 'de.json'),
      JSON.stringify({ loadFailed: 'Laden <fehlgeschlagen>', retry: "Nochmal '{'versuchen'}'" }),
    );
    http = await serveDashboard(dir);
    const port = (http.server.address() as AddressInfo).port;
    const body = (await req(port, '/')).body;
    strictEqual(body.includes('<p>Laden &lt;fehlgeschlagen&gt;</p>'), true);
    strictEqual(
      body.includes('<button type="button" class="ohne-raw">Nochmal {versuchen}</button>'),
      true,
    );
  });

  it('answers a group in the default language down its chain, for an API that cannot', async () => {
    const dir = makeApp('fallback-messages');
    writeFileSync(
      join(dir, 'ohne.config.ts'),
      "export default { messages: { defaultLanguage: 'de-AT' } }\n",
    );
    mkdirSync(join(dir, 'messages', 'shop'), { recursive: true });
    writeFileSync(join(dir, 'messages', 'shop', 'de.json'), JSON.stringify({ cart: 'Warenkorb' }));
    writeFileSync(join(dir, 'messages', 'shop', 'fr.json'), JSON.stringify({ cart: 'Panier' }));
    http = await serveDashboard(dir);
    const port = (http.server.address() as AddressInfo).port;
    const res = await req(port, '/m/messages/shop');
    strictEqual(res.status, 200);
    deepStrictEqual(JSON.parse(res.body), {
      'shop.cart': { template: 'Warenkorb', language: 'de' },
    });
    strictEqual((await req(port, '/m/messages/nothing')).status, 404);
  });

  it('answers its errors in the default language, as the API does', async () => {
    const dir = makeApp('translated-errors');
    writeFileSync(
      join(dir, 'ohne.config.ts'),
      "export default { messages: { defaultLanguage: 'de' } }\n",
    );
    mkdirSync(join(dir, 'messages', 'api'), { recursive: true });
    writeFileSync(
      join(dir, 'messages', 'api', 'de.json'),
      JSON.stringify({ http: { notFound: 'Nicht gefunden' } }),
    );
    http = await serveDashboard(dir);
    const port = (http.server.address() as AddressInfo).port;
    for (const path of ['/m/messages/..%2F..', '/m/icon/not-an-icon', '/m/messages/nothing']) {
      strictEqual(JSON.parse((await req(port, path)).body).message, 'Nicht gefunden');
    }
  });

  it('omits the reload client and its stream route by default', async () => {
    const port = await serve('no-reload');
    strictEqual(
      (await req(port, '/')).body.includes('src="/m/dashboard/runtime/reload-client.ts'),
      false,
    );
    strictEqual((await req(port, '/m/dashboard/reload')).status, 404);
  });

  it('injects the reload client when `DASHBOARD_RELOAD` is set', async () => {
    useEnv().set('DASHBOARD_RELOAD', true);
    const port = await serve('reload');
    const body = (await req(port, '/')).body;
    const src = importsOf(body)['/m/dashboard/runtime/reload-client.ts'];
    match(src ?? '', /\?h=[\w-]{8}$/);
    strictEqual(body.includes(`<script type="module" src="${src}">`), true);
  });

  it('warns when the dashboard folder has no tsconfig.json', async () => {
    const dir = makeApp('tsconfig-warn');
    mkdirSync(join(dir, 'dashboard'));
    const buf = captureWarnings();
    http = await serveDashboard(dir);

    const out = buf.join('');
    strictEqual(out.includes('Dashboard has no tsconfig.json'), true);
    strictEqual(out.includes('"extends": "../.ohne/browser/tsconfig.json"'), true);
    strictEqual(out.includes('tsc && tsc -p dashboard/tsconfig.json'), true);
  });

  it('derives the suggested tsconfig from the configured dirs', async () => {
    const dir = makeApp('tsconfig-dirs');
    writeFileSync(
      join(dir, 'ohne.config.ts'),
      "export default { dirs: { dashboard: 'src/ui', codegen: 'generated' } }\n",
    );
    mkdirSync(join(dir, 'src', 'ui'), { recursive: true });
    const buf = captureWarnings();
    http = await serveDashboard(dir);

    const out = buf.join('');
    strictEqual(out.includes('"extends": "../../generated/browser/tsconfig.json"'), true);
    strictEqual(out.includes('tsc -p src/ui/tsconfig.json'), true);
  });

  it('does not warn when the dashboard tsconfig exists or the folder is absent', async () => {
    const buf = captureWarnings();
    http = await serveDashboard(makeApp('tsconfig-absent'));
    await shutdownServer(http.server, http.gate);
    http = undefined;

    const present = makeApp('tsconfig-present');
    mkdirSync(join(present, 'dashboard'));
    writeFileSync(join(present, 'dashboard', 'tsconfig.json'), '{}');
    http = await serveDashboard(present);

    strictEqual(buf.join('').includes('Dashboard has no'), false);
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

  it('lists a boot file in the config and serves its module under /m/app', async () => {
    const dir = makeApp('app-boot');
    writeBoot(dir, 'fields.ts', 'app:fields');
    writeBoot(dir, '_shared.ts', 'app:shared');
    http = await serveDashboard(dir);
    const port = (http.server.address() as AddressInfo).port;

    strictEqual((await req(port, '/')).body.includes('"boot":["/m/app/boot/fields.ts"]'), true);

    const mod = await req(port, '/m/app/boot/fields.ts');
    strictEqual(mod.status, 200);
    strictEqual(mod.headers['content-type'], 'text/javascript; charset=utf-8');
  });

  it('lists layer boot files furthest-first and serves a shared path from the closer layer', async () => {
    const base = makeApp('base');
    writeBoot(base, 'slots.ts', 'base:slots');
    writeBoot(base, 'fields.ts', 'base:fields');
    const dir = makeApp('app-boot-layers');
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'app', type: 'module', dependencies: { base: '*' } }),
    );
    writeFileSync(join(dir, 'ohne.config.ts'), "export default { layers: ['base'] }\n");
    mkdirSync(join(dir, 'node_modules'));
    symlinkSync(base, join(dir, 'node_modules', 'base'), 'dir');
    writeBoot(dir, 'theme.ts', 'app:theme');
    writeBoot(dir, 'fields.ts', 'app:fields');
    http = await serveDashboard(dir);
    const port = (http.server.address() as AddressInfo).port;

    strictEqual(
      (await req(port, '/')).body.includes(
        '"boot":["/m/app/boot/fields.ts","/m/app/boot/slots.ts","/m/app/boot/theme.ts"]',
      ),
      true,
    );
    strictEqual((await req(port, '/m/app/boot/fields.ts')).body.includes('app:fields'), true);
    strictEqual((await req(port, '/m/app/boot/slots.ts')).body.includes('base:slots'), true);
  });

  it('blocks path traversal out of the app module root', async () => {
    const port = await serve('app-traversal');
    strictEqual((await req(port, '/m/app/%2Fetc%2Fpasswd')).status, 404);
  });

  it('serves one icon shape by name', async () => {
    const port = await serve('icon');
    const res = await req(port, '/m/icon/note');
    strictEqual(res.status, 200);
    strictEqual(res.headers['content-type'], 'text/plain; charset=utf-8');
    strictEqual(res.body.startsWith('<path '), true);
    strictEqual(res.body.includes('<svg'), false);
  });

  it('serves an icon the dashboard does not inline', async () => {
    const port = await serve('icon-lazy');
    strictEqual((await req(port, '/m/icon/brand-github')).status, 200);
  });

  it('answers an unknown icon name with 404', async () => {
    const port = await serve('icon-missing');
    strictEqual((await req(port, '/m/icon/not-an-icon')).status, 404);
  });

  it('does not serve an inherited name as an icon', async () => {
    const port = await serve('icon-inherited');
    strictEqual((await req(port, '/m/icon/constructor')).status, 404);
    strictEqual((await req(port, '/m/icon/toString')).status, 404);
  });

  it('answers 304 when the client already holds the shape', async () => {
    const port = await serve('icon-etag');
    const first = await req(port, '/m/icon/note');
    const tag = first.headers['etag'];
    strictEqual(typeof tag, 'string');
    const second = await req(port, '/m/icon/note', { 'if-none-match': tag as string });
    strictEqual(second.status, 304);
  });
});

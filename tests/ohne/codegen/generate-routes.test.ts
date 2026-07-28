import { deepStrictEqual, rejects, strictEqual } from 'node:assert';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';

import { BANNER } from '../../../src/ohne/codegen/codegen-dir.ts';
import { generateRoutes, loadLayers, useLayers } from '../../../src/ohne/index.ts';

interface PackageSpec {
  name: string;
  ohne?: boolean;
  layers?: string[];
  dependencies?: Record<string, string>;
  exports?: Record<string, string>;
}

describe('generateRoutes', () => {
  let root: string;

  function writePackage(at: string, spec: PackageSpec): void {
    mkdirSync(at, { recursive: true });
    const { ohne, layers, ...manifest } = spec;
    writeFileSync(join(at, 'package.json'), JSON.stringify({ ...manifest, type: 'module' }));
    const config = layers ? `export default { layers: ${JSON.stringify(layers)} };\n` : '';
    if (ohne) writeFileSync(join(at, 'ohne.config.ts'), config);
  }

  function writeDep(app: string, name: string, spec: PackageSpec): string {
    const dir = join(app, 'packages', name);
    writePackage(dir, spec);
    mkdirSync(join(app, 'node_modules'), { recursive: true });
    symlinkSync(dir, join(app, 'node_modules', name), 'dir');
    return dir;
  }

  function writeRoute(layerDir: string, relative: string): void {
    const file = join(layerDir, 'api', relative);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, 'export default () => null\n');
  }

  const bucketFile = (paths: string[], bucket: string): string =>
    paths.find((path) => path.endsWith(`/.ohne/${bucket}/routes.ts`))!;

  before(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'ohne-gen-routes-')));
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  afterEach(() => {
    for (const layer of useLayers().layers()) useLayers().remove(layer.path);
  });

  it('emits imports, types, and registrations for the combined table', async () => {
    const app = join(root, 'app');
    writePackage(app, { name: 'app', ohne: true, layers: ['a'], dependencies: { a: '*' } });
    const dep = writeDep(app, 'a', { name: 'a', ohne: true });

    writeRoute(dep, 'index.get.ts');
    writeRoute(app, 'health.ts');
    writeRoute(app, 'users/[id].get.ts');

    await loadLayers(app);
    const paths = await generateRoutes(app);
    const out = readFileSync(bucketFile(paths, 'node'), 'utf8');

    strictEqual(out.includes("import { useRoutes } from 'ohne';"), true);
    strictEqual(out.includes('interface KnownRoutes {'), true);
    strictEqual(out.includes("'/health': typeof h0;"), true);
    strictEqual(out.includes("'GET /': typeof h1;"), true);
    strictEqual(out.includes("'GET /users/[id]': typeof h2;"), true);

    strictEqual(out.includes('const routes = useRoutes();'), true);
    strictEqual(out.includes("routes.register('/health', {"), true);
    strictEqual(out.includes('method: null,'), true);
    strictEqual(out.includes("pattern: '/users/[id]',"), true);
    strictEqual(out.includes("layer: 'a',"), true);
    strictEqual(out.includes("layer: 'app',"), true);
    strictEqual(out.includes('handler: h2,'), true);

    strictEqual(out.includes("import h0 from '../../api/health.ts';"), true);
    strictEqual(out.includes("import h1 from '../../packages/a/api/index.get.ts';"), true);

    const shared = readFileSync(bucketFile(paths, 'shared'), 'utf8');
    strictEqual(shared.includes('export interface GeneratedAPIRoutes {'), true);
    strictEqual(shared.includes("'/health': true;"), true);
    strictEqual(shared.includes("'GET /users/[id]': true;"), true);

    const browser = readFileSync(bucketFile(paths, 'browser'), 'utf8');
    strictEqual(browser.includes('interface KnownAPIRoutes extends GeneratedAPIRoutes {}'), true);
  });

  it('rejects a route filename whose character breaks its generated import', async () => {
    const app = join(root, 'special-name');
    writePackage(app, { name: 'special-name', ohne: true });
    writeRoute(app, '50%off.get.ts');

    await loadLayers(app);
    await rejects(generateRoutes(app), /Unsupported character `%` in a route path/);
  });

  it('leaves out an installed layer no config lists', async () => {
    const app = join(root, 'unlisted');
    writePackage(app, { name: 'unlisted', ohne: true, dependencies: { a: '*' } });
    const dep = writeDep(app, 'a', { name: 'a', ohne: true });

    writeRoute(dep, 'secret.get.ts');
    writeRoute(app, 'home.get.ts');

    await loadLayers(app);
    const out = readFileSync(bucketFile(await generateRoutes(app), 'node'), 'utf8');

    strictEqual(out.includes("'GET /home'"), true);
    strictEqual(out.includes('secret'), false);
  });

  it('collects the routes of a listed subpath layer', async () => {
    const app = join(root, 'subpath');
    writePackage(app, {
      name: 'subpath',
      ohne: true,
      layers: ['kit/auth'],
      dependencies: { kit: '*' },
    });
    const kit = writeDep(app, 'kit', {
      name: 'kit',
      exports: { './auth': './auth/ohne.config.ts' },
    });
    const auth = join(kit, 'auth');
    mkdirSync(auth, { recursive: true });
    writeFileSync(join(auth, 'ohne.config.ts'), '');

    writeRoute(auth, 'hello.get.ts');

    await loadLayers(app);
    const out = readFileSync(bucketFile(await generateRoutes(app), 'node'), 'utf8');

    strictEqual(out.includes("'GET /hello'"), true);
    strictEqual(out.includes("layer: 'kit/auth',"), true);
  });

  it('overrides in stack order, not dependency declaration order', async () => {
    const app = join(root, 'precedence');
    writePackage(app, {
      name: 'precedence',
      ohne: true,
      layers: ['b', 'a'],
      dependencies: { a: '*', b: '*' },
    });
    const depA = writeDep(app, 'a', { name: 'a', ohne: true });
    const depB = writeDep(app, 'b', { name: 'b', ohne: true });

    writeRoute(depA, 'x.get.ts');
    writeRoute(depB, 'x.get.ts');

    await loadLayers(app);
    const out = readFileSync(bucketFile(await generateRoutes(app), 'node'), 'utf8');

    strictEqual(out.includes("layer: 'a',"), true);
    strictEqual(out.includes("layer: 'b',"), false);
  });

  it('emits an empty interface when there are no routes', async () => {
    const app = join(root, 'empty');
    writePackage(app, { name: 'empty', ohne: true });

    await loadLayers(app);
    const paths = await generateRoutes(app);
    strictEqual(
      readFileSync(bucketFile(paths, 'node'), 'utf8'),
      `${BANNER}\n` +
        "import type {} from 'ohne';\n" +
        '\n' +
        "declare module 'ohne' {\n" +
        '  interface KnownRoutes {}\n' +
        '}\n',
    );
    strictEqual(
      readFileSync(bucketFile(paths, 'shared'), 'utf8'),
      `${BANNER}\n` + 'export interface GeneratedAPIRoutes {}\n',
    );
    strictEqual(
      readFileSync(bucketFile(paths, 'browser'), 'utf8'),
      `${BANNER}\n` +
        "import type {} from 'ohne/dashboard';\n" +
        "import type { GeneratedAPIRoutes } from '../shared/routes.ts';\n" +
        '\n' +
        "declare module 'ohne/dashboard' {\n" +
        '  interface KnownAPIRoutes extends GeneratedAPIRoutes {}\n' +
        '}\n',
    );
  });

  it('returns no paths when no package.json is found', async () => {
    deepStrictEqual(await generateRoutes(join(root, 'nowhere')), []);
  });
});

import { strictEqual } from 'node:assert';
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
    writeFileSync(join(at, 'package.json'), JSON.stringify(manifest));
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
    const path = await generateRoutes(app);
    strictEqual(path?.endsWith('/.ohne/node/routes.ts'), true);
    const out = readFileSync(path!, 'utf8');

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
  });

  it('leaves out an installed layer no config lists', async () => {
    const app = join(root, 'unlisted');
    writePackage(app, { name: 'unlisted', ohne: true, dependencies: { a: '*' } });
    const dep = writeDep(app, 'a', { name: 'a', ohne: true });

    writeRoute(dep, 'secret.get.ts');
    writeRoute(app, 'home.get.ts');

    await loadLayers(app);
    const out = readFileSync((await generateRoutes(app))!, 'utf8');

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
    const out = readFileSync((await generateRoutes(app))!, 'utf8');

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
    const out = readFileSync((await generateRoutes(app))!, 'utf8');

    strictEqual(out.includes("layer: 'a',"), true);
    strictEqual(out.includes("layer: 'b',"), false);
  });

  it('emits an empty interface when there are no routes', async () => {
    const app = join(root, 'empty');
    writePackage(app, { name: 'empty', ohne: true });

    await loadLayers(app);
    const path = await generateRoutes(app);
    strictEqual(
      readFileSync(path!, 'utf8'),
      '// Generated by ohne. Do not edit.\n' +
        "import type {} from 'ohne';\n" +
        '\n' +
        "declare module 'ohne' {\n" +
        '  interface KnownRoutes {}\n' +
        '}\n',
    );
  });

  it('returns null when no package.json is found', async () => {
    strictEqual(await generateRoutes(join(root, 'nowhere')), null);
  });
});

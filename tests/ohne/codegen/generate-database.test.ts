import { ok, strictEqual } from 'node:assert';
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

import { generateDatabase, loadLayers, useLayers } from '../../../src/ohne/index.ts';

describe('generateDatabase', () => {
  let root: string;

  function writePackage(at: string, name: string, layers?: string[]): void {
    mkdirSync(at, { recursive: true });
    const dependencies = Object.fromEntries((layers ?? []).map((layer) => [layer, '*']));
    writeFileSync(join(at, 'package.json'), JSON.stringify({ name, type: 'module', dependencies }));
    const config = layers
      ? `export default { layers: ${JSON.stringify(layers)} };\n`
      : 'export default {};\n';
    writeFileSync(join(at, 'ohne.config.ts'), config);
  }

  function writeMigration(layerDir: string, relative: string): void {
    const file = join(layerDir, 'migrations', relative);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, 'export default { from: { table: "Posts" }, to: null };\n');
  }

  before(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'ohne-gen-database-')));
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  afterEach(() => {
    for (const layer of useLayers().layers()) useLayers().remove(layer.path);
  });

  it('emits imports and registrations in execution order', async () => {
    const app = join(root, 'app');
    writePackage(app, 'app', ['dep']);
    const dep = join(app, 'packages', 'dep');
    writePackage(dep, 'dep');
    mkdirSync(join(app, 'node_modules'), { recursive: true });
    symlinkSync(dep, join(app, 'node_modules', 'dep'), 'dir');

    writeMigration(dep, '001-keys.ts');
    writeMigration(app, '001-posts.ts');

    await loadLayers(app);
    const paths = await generateDatabase(app);
    strictEqual(paths.length, 1);
    const out = readFileSync(paths[0] ?? '', 'utf8');

    ok(out.includes("import { useMigrations } from 'ohne';"));
    ok(out.includes("migrations.register('dep/001-keys', {"));
    ok(out.includes("migrations.register('app/001-posts', {"));
    ok(out.indexOf('dep/001-keys') < out.indexOf('app/001-posts'));
    ok(out.includes(`file: '${join(dep, 'migrations', '001-keys.ts')}',`));
  });

  it('writes an empty module when no layer has migrations', async () => {
    const app = join(root, 'empty');
    writePackage(app, 'empty');
    await loadLayers(app);
    const paths = await generateDatabase(app);
    strictEqual(paths.length, 1);
    const out = readFileSync(paths[0] ?? '', 'utf8');
    ok(!out.includes('useMigrations'));
  });
});

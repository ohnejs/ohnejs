import { ok, rejects, strictEqual } from 'node:assert';
import { execFileSync } from 'node:child_process';
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

const FRAMEWORK = join(import.meta.dirname, '..', '..', '..');

describe('generateDatabase', () => {
  let root: string;

  function writePackage(at: string, name: string, layers?: string[], config?: string): void {
    mkdirSync(at, { recursive: true });
    const dependencies = Object.fromEntries((layers ?? []).map((layer) => [layer, '*']));
    writeFileSync(join(at, 'package.json'), JSON.stringify({ name, type: 'module', dependencies }));
    const fallback = layers
      ? `export default { layers: ${JSON.stringify(layers)} };\n`
      : 'export default {};\n';
    writeFileSync(join(at, 'ohne.config.ts'), config ?? fallback);
  }

  function write(dir: string, relative: string, content: string): void {
    const file = join(dir, relative);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, content);
  }

  function writeMigration(layerDir: string, relative: string): void {
    write(
      layerDir,
      join('migrations', relative),
      'export default { from: { table: "Posts" }, to: null };\n',
    );
  }

  before(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'ohne-gen-database-')));
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  afterEach(() => {
    useLayers().clear();
  });

  it('emits migration imports and registrations in execution order', async () => {
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
    strictEqual(paths.length, 2);
    const out = readFileSync(paths[1] ?? '', 'utf8');

    ok(out.includes("import { useMigrations } from 'ohne';"));
    ok(out.includes("migrations.register('dep/001-keys', {"));
    ok(out.includes("migrations.register('app/001-posts', {"));
    ok(out.indexOf('dep/001-keys') < out.indexOf('app/001-posts'));
    ok(out.includes(`file: '${join(dep, 'migrations', '001-keys.ts')}',`));
  });

  it('writes empty modules when no layer has definitions', async () => {
    const app = join(root, 'empty');
    writePackage(app, 'empty');
    await loadLayers(app);
    const paths = await generateDatabase(app);
    strictEqual(paths.length, 2);
    const shared = readFileSync(paths[0] ?? '', 'utf8');
    const node = readFileSync(paths[1] ?? '', 'utf8');
    ok(shared.includes('export interface GeneratedCollections {}'));
    ok(shared.includes('export interface GeneratedDatabases {}'));
    ok(node.includes('interface KnownCollections extends GeneratedCollections {}'));
    ok(node.includes('interface KnownDatabases extends GeneratedDatabases {}'));
    ok(node.includes('interface KnownFields {}'));
    ok(!node.includes('useMigrations'));
    ok(!node.includes('register('));
  });

  it('types every helper-database name', async () => {
    const app = join(root, 'helpers');
    writePackage(
      app,
      'helpers',
      undefined,
      "export default { database: { helpers: { rateLimit: ':memory:', cache: ':memory:' } } };\n",
    );
    await loadLayers(app);
    const paths = await generateDatabase(app);
    const shared = readFileSync(paths[0] ?? '', 'utf8');
    ok(shared.includes('export interface GeneratedDatabases {'));
    ok(shared.includes('  cache: true;'));
    ok(shared.includes('  rateLimit: true;'));
  });

  it('registers collections and field types, a closer layer overriding by name', async () => {
    const app = join(root, 'override');
    writePackage(app, 'override', ['dep']);
    const dep = join(app, 'packages', 'dep');
    writePackage(dep, 'dep');
    mkdirSync(join(app, 'node_modules'), { recursive: true });
    symlinkSync(dep, join(app, 'node_modules', 'dep'), 'dir');

    write(dep, 'collections/Posts.ts', 'export default { fields: {} };\n');
    write(dep, 'fields/slug.ts', "export default { columnType: 'text' };\n");
    write(app, 'collections/Posts.ts', 'export default { fields: {} };\n');

    await loadLayers(app);
    const paths = await generateDatabase(app);
    const out = readFileSync(paths[1] ?? '', 'utf8');

    ok(out.includes("import { useCollections, useFields } from 'ohne';"));
    ok(out.includes(`import c0 from '../../collections/Posts.ts';`));
    ok(!out.includes('packages/dep/collections'));
    ok(out.includes("collections.register('Posts', { name: 'Posts', collection: c0 });"));
    ok(out.includes("fields.register('slug', { name: 'slug', fieldType: f0 });"));
    ok(out.includes("slug: typeof import('../../packages/dep/fields/slug.ts').default;"));
  });

  it('types every collection record shape in the shared bucket', async () => {
    const app = join(root, 'shapes');
    writePackage(app, 'shapes');
    write(app, 'fields/_geo.ts', 'export interface LatLng { lat: number; lng: number }\n');
    write(
      app,
      'fields/point.ts',
      'export default {\n' +
        "  columnType: 'text',\n" +
        "  emitType: (ctx) => ['{', '  lat: number', `  lng: ${ctx.importType('./_geo.ts', 'LatLng')}`, '}'],\n" +
        '};\n',
    );
    write(
      app,
      'collections/Posts.ts',
      'export default { fields: {\n' +
        "  location: { type: 'point', options: {} },\n" +
        "  title: { type: 'text', options: { nullable: true } },\n" +
        '} };\n',
    );

    await loadLayers(app);
    const paths = await generateDatabase(app);
    const shared = readFileSync(paths[0] ?? '', 'utf8');

    ok(shared.includes("import type { LatLng } from '../../fields/_geo.ts';"));
    ok(shared.includes('  Posts: {'));
    ok(shared.includes('    location: {'));
    ok(shared.includes('      lat: number'));
    ok(shared.includes('      lng: LatLng'));
    ok(shared.includes('    };'));
    ok(shared.includes('    title: string | null;'));
  });

  it('drops disabled collections and field types, deleting a disabled built-in', async () => {
    const app = join(root, 'disabled');
    writePackage(
      app,
      'disabled',
      undefined,
      "export default { disable: { collections: ['Posts'], fields: ['slug', 'boolean'] } };\n",
    );
    write(app, 'collections/Posts.ts', 'export default { fields: {} };\n');
    write(app, 'collections/Authors.ts', 'export default { fields: {} };\n');
    write(app, 'fields/slug.ts', "export default { columnType: 'text' };\n");

    await loadLayers(app);
    const paths = await generateDatabase(app);
    const shared = readFileSync(paths[0] ?? '', 'utf8');
    const node = readFileSync(paths[1] ?? '', 'utf8');

    ok(node.includes("collections.register('Authors'"));
    ok(!node.includes("collections.register('Posts'"));
    ok(!node.includes('slug'));
    ok(node.includes("fields.delete('boolean');"));
    ok(shared.includes('Authors: {};'));
    ok(!shared.includes('Posts'));
  });

  it('registers a built-in override without augmenting its name', async () => {
    const app = join(root, 'builtin');
    writePackage(app, 'builtin');
    write(app, 'fields/text.ts', "export default { columnType: 'json' };\n");
    write(
      app,
      'collections/Posts.ts',
      "export default { fields: { title: { type: 'text', options: {} } } };\n",
    );

    await loadLayers(app);
    const paths = await generateDatabase(app);
    const shared = readFileSync(paths[0] ?? '', 'utf8');
    const node = readFileSync(paths[1] ?? '', 'utf8');

    ok(node.includes("fields.register('text', { name: 'text', fieldType: f0 });"));
    ok(!node.includes('text: typeof import'));
    ok(shared.includes('title: unknown;'));
  });

  it('generated registrations typecheck in a consumer app', async () => {
    const app = join(root, 'consumer');
    writePackage(app, 'consumer');
    mkdirSync(join(app, 'node_modules', '@types'), { recursive: true });
    symlinkSync(FRAMEWORK, join(app, 'node_modules', 'ohne'), 'dir');
    symlinkSync(
      join(FRAMEWORK, 'node_modules', '@types', 'node'),
      join(app, 'node_modules', '@types', 'node'),
      'dir',
    );
    writeFileSync(
      join(app, 'tsconfig.json'),
      JSON.stringify({
        extends: 'ohne/tsconfig.node.json',
        include: ['**/*.ts', '.ohne/shared/**/*.ts', '.ohne/node/**/*.ts'],
      }),
    );
    write(
      app,
      'fields/status.ts',
      "import { defineField, option } from 'ohne';\n" +
        'export default defineField({\n' +
        "  columnType: 'text',\n" +
        "  options: { choices: option<string[]>({ required: true }), initial: option({ default: 'open' }) },\n" +
        "  emitType: (ctx) => ctx.options.choices.map((choice) => `'${choice}'`).join(' | '),\n" +
        '});\n',
    );
    write(
      app,
      'collections/Todos.ts',
      "import { defineCollection, field } from 'ohne';\n" +
        'export default defineCollection({\n' +
        "  fields: { title: field('text', { unique: true }), status: field('status', { choices: ['open', 'done'] }) },\n" +
        "  compositeIndexes: [{ fields: ['title', 'status'] }],\n" +
        '});\n',
    );

    await loadLayers(app);
    await generateDatabase(app);

    execFileSync(
      process.execPath,
      [join(FRAMEWORK, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', app],
      { encoding: 'utf8' },
    );
  });

  it('rejects a collection referencing an unknown field type, naming the file', async () => {
    const app = join(root, 'unknown');
    writePackage(app, 'unknown');
    write(
      app,
      'collections/Posts.ts',
      "export default { fields: { rel: { type: 'records', options: {} } } };\n",
    );

    await loadLayers(app);
    await rejects(generateDatabase(app), /Unknown field type `records`/);
  });
});

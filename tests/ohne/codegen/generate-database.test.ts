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
    ok(shared.includes('export interface GeneratedBlocks {}'));
    ok(shared.includes('export interface GeneratedDatabases {}'));
    ok(node.includes('interface KnownCollections extends GeneratedCollections {}'));
    ok(node.includes('interface KnownBlocks extends GeneratedBlocks {}'));
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
    ok(shared.includes('    UUID: string;'));
    ok(shared.includes('    _updatedAt: number;'));
    ok(shared.includes('    location: {'));
    ok(shared.includes('      lat: number'));
    ok(shared.includes('      lng: LatLng'));
    ok(shared.includes('    };'));
    ok(shared.includes('    title: string | null;'));
  });

  it('assembles composite record shapes from subfields, nesting and wrapping by cardinality', async () => {
    const app = join(root, 'composites');
    writePackage(app, 'composites');
    write(
      app,
      'collections/Posts.ts',
      'export default { fields: {\n' +
        "  address: { type: 'object', options: { fields: {\n" +
        "    street: { type: 'text', options: {} },\n" +
        "    city: { type: 'text', options: { nullable: true } },\n" +
        '  } } },\n' +
        "  sections: { type: 'repeater', options: { fields: {\n" +
        "    title: { type: 'text', options: {} },\n" +
        "    items: { type: 'repeater', options: { fields: { label: { type: 'text', options: {} } } } },\n" +
        '  } } },\n' +
        '} };\n',
    );

    await loadLayers(app);
    const paths = await generateDatabase(app);
    const shared = readFileSync(paths[0] ?? '', 'utf8');

    ok(
      shared.includes(
        '    address: {\n      UUID: string;\n      street: string;\n      city: string | null;\n    } | null;',
      ),
    );
    ok(
      shared.includes(
        '    sections: {\n      UUID: string;\n      title: string;\n      items: {\n        UUID: string;\n        label: string;\n      }[];\n    }[];',
      ),
    );
  });

  it('carries a field `when` into GeneratedQueryFields as a type literal', async () => {
    const app = join(root, 'when');
    writePackage(app, 'when');
    write(
      app,
      'collections/Products.ts',
      'export default { fields: {\n' +
        "  kind: { type: 'text', options: {} },\n" +
        "  discount: { type: 'integer', options: { nullable: true, when: { kind: 'sale' } } },\n" +
        '} };\n',
    );

    await loadLayers(app);
    const paths = await generateDatabase(app);
    const shared = readFileSync(paths[0] ?? '', 'utf8');

    ok(shared.includes("discount: { scalar: number; nullable: true; when: { kind: 'sale' } };"));
  });

  it('types block shapes into GeneratedBlocks, a blocks field unioning its allowed names', async () => {
    const app = join(root, 'blocks');
    writePackage(app, 'blocks');
    write(
      app,
      'blocks/CTA.ts',
      'export default { fields: {\n' +
        "  label: { type: 'text', options: {} },\n" +
        "  url: { type: 'text', options: { nullable: true } },\n" +
        '} };\n',
    );
    write(
      app,
      'blocks/Hero.ts',
      "export default { fields: { title: { type: 'text', options: {} } } };\n",
    );
    write(
      app,
      'collections/Pages.ts',
      'export default { fields: {\n' +
        "  body: { type: 'blocks', options: {} },\n" +
        "  hero: { type: 'blocks', options: { allow: ['Hero'] } },\n" +
        '} };\n',
    );

    await loadLayers(app);
    const paths = await generateDatabase(app);
    const shared = readFileSync(paths[0] ?? '', 'utf8');
    const node = readFileSync(paths[1] ?? '', 'utf8');

    ok(shared.includes('export interface GeneratedBlocks {'));
    ok(shared.includes('  CTA: {\n    label: string;\n    url: string | null;\n  };'));
    ok(shared.includes('  Hero: {\n    title: string;\n  };'));
    ok(shared.includes("    hero: { block: 'Hero'; fields: GeneratedBlocks['Hero'] }[];"));
    ok(
      shared.includes(
        '    body: (\n' +
          "      | { block: 'CTA'; fields: GeneratedBlocks['CTA'] }\n" +
          "      | { block: 'Hero'; fields: GeneratedBlocks['Hero'] }\n" +
          '    )[];',
      ),
    );
    ok(node.includes("import { useCollections, useBlocks } from 'ohne';"));
    ok(node.includes('interface KnownBlocks extends GeneratedBlocks {}'));
    ok(node.includes("import b0 from '../../blocks/CTA.ts';"));
    ok(node.includes("blocks.register('CTA', { name: 'CTA', block: b0 });"));
    ok(node.includes("blocks.register('Hero', { name: 'Hero', block: b1 });"));
  });

  it('nests a blocks field inside a block, a self-reference included', async () => {
    const app = join(root, 'nested-blocks');
    writePackage(app, 'nested-blocks');
    write(
      app,
      'blocks/CTA.ts',
      "export default { fields: { label: { type: 'text', options: {} } } };\n",
    );
    write(
      app,
      'blocks/Hero.ts',
      'export default { fields: {\n' +
        "  cards: { type: 'blocks', options: { allow: ['CTA'] } },\n" +
        "  more: { type: 'blocks', options: { allow: ['Hero'] } },\n" +
        '} };\n',
    );

    await loadLayers(app);
    const paths = await generateDatabase(app);
    const shared = readFileSync(paths[0] ?? '', 'utf8');

    ok(shared.includes("    cards: { block: 'CTA'; fields: GeneratedBlocks['CTA'] }[];"));
    ok(shared.includes("    more: { block: 'Hero'; fields: GeneratedBlocks['Hero'] }[];"));
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
    ok(shared.includes('Authors: {\n    UUID: string;\n    _updatedAt: number;\n  };'));
    ok(!shared.includes('Posts'));
  });

  it('drops a disabled block, an open blocks field shrinking around it', async () => {
    const app = join(root, 'disabled-block');
    writePackage(
      app,
      'disabled-block',
      undefined,
      "export default { disable: { blocks: ['CTA'] } };\n",
    );
    write(
      app,
      'blocks/CTA.ts',
      "export default { fields: { label: { type: 'text', options: {} } } };\n",
    );
    write(
      app,
      'blocks/Hero.ts',
      "export default { fields: { title: { type: 'text', options: {} } } };\n",
    );
    write(
      app,
      'collections/Pages.ts',
      "export default { fields: { body: { type: 'blocks', options: {} } } };\n",
    );

    await loadLayers(app);
    const paths = await generateDatabase(app);
    const shared = readFileSync(paths[0] ?? '', 'utf8');
    const node = readFileSync(paths[1] ?? '', 'utf8');

    ok(shared.includes("    body: { block: 'Hero'; fields: GeneratedBlocks['Hero'] }[];"));
    ok(!shared.includes('CTA'));
    ok(node.includes("blocks.register('Hero'"));
    ok(!node.includes('CTA'));
  });

  it('rejects a blocks field still allowing a disabled block', async () => {
    const app = join(root, 'disabled-allow');
    writePackage(
      app,
      'disabled-allow',
      undefined,
      "export default { disable: { blocks: ['CTA'] } };\n",
    );
    write(app, 'blocks/CTA.ts', 'export default { fields: {} };\n');
    write(
      app,
      'collections/Pages.ts',
      "export default { fields: { body: { type: 'blocks', options: { allow: ['CTA'] } } } };\n",
    );

    await loadLayers(app);
    await rejects(generateDatabase(app), /Unknown block `CTA`/);
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
        '  fields: {\n' +
        "    title: field('text', { unique: true }),\n" +
        "    status: field('status', { choices: ['open', 'done'] }),\n" +
        "    meta: field('object', { fields: { color: field('text', { nullable: true }) } }),\n" +
        "    checklist: field('repeater', { fields: { label: field('text'), done: field('boolean') } }),\n" +
        '  },\n' +
        "  compositeIndexes: [{ fields: ['title', 'status'] }],\n" +
        '});\n',
    );
    write(
      app,
      'typing.ts',
      "import type { KnownCollections } from 'ohne';\n" +
        '\n' +
        "export function shape(todo: KnownCollections['Todos']): string {\n" +
        '  const labels = todo.checklist.map((item) => (item.done ? item.label : item.label.toUpperCase()));\n' +
        "  const color = todo.meta === null ? 'none' : (todo.meta.color ?? 'unset');\n" +
        "  return [todo.status, color, ...labels].join(' ');\n" +
        '}\n' +
        '// @ts-expect-error a repeater list is never null\n' +
        "export const bad: KnownCollections['Todos']['checklist'] = null;\n",
    );

    await loadLayers(app);
    await generateDatabase(app);

    execFileSync(
      process.execPath,
      [join(FRAMEWORK, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', app],
      { encoding: 'utf8' },
    );
  });

  it('types relation fields and maps owning records fields into GeneratedRelations', async () => {
    const app = join(root, 'relations');
    writePackage(app, 'relations');
    write(
      app,
      'collections/Users.ts',
      'export default { fields: {\n' +
        "  posts: { type: 'records', options: { collection: 'Posts', inverse: 'reviewers' } },\n" +
        '} };\n',
    );
    write(
      app,
      'collections/Posts.ts',
      'export default { fields: {\n' +
        "  author: { type: 'record', options: { collection: 'Users' } },\n" +
        "  reviewers: { type: 'records', options: { collection: 'Users' } },\n" +
        '} };\n',
    );

    await loadLayers(app);
    const paths = await generateDatabase(app);
    const shared = readFileSync(paths[0] ?? '', 'utf8');
    const node = readFileSync(paths[1] ?? '', 'utf8');

    ok(shared.includes('author: string | null;'));
    ok(shared.includes('reviewers: string[];'));
    ok(shared.includes('posts: string[];'));
    ok(shared.includes('export interface GeneratedRelations {'));
    ok(shared.includes("reviewers: 'Users';"));
    ok(shared.includes('Users: {};'));
    ok(!shared.includes("posts: 'Posts';"));
    ok(node.includes('interface KnownRelations extends GeneratedRelations {}'));
  });

  it('emits create-input shapes into GeneratedInserts, optional where nullable or defaulted', async () => {
    const app = join(root, 'inserts');
    writePackage(app, 'inserts');
    write(
      app,
      'collections/Users.ts',
      "export default { fields: { name: { type: 'text', options: {} } } };\n",
    );
    write(
      app,
      'collections/Tags.ts',
      "export default { fields: { label: { type: 'text', options: {} } } };\n",
    );
    write(
      app,
      'collections/Posts.ts',
      'export default { fields: {\n' +
        "  title: { type: 'text', options: {} },\n" +
        "  summary: { type: 'text', options: { nullable: true } },\n" +
        "  rank: { type: 'integer', options: { default: 0 } },\n" +
        "  author: { type: 'record', options: { collection: 'Users' } },\n" +
        "  tags: { type: 'records', options: { collection: 'Tags' } },\n" +
        "  items: { type: 'repeater', options: { fields: { label: { type: 'text', options: {} } } } },\n" +
        '} };\n',
    );

    await loadLayers(app);
    const paths = await generateDatabase(app);
    const shared = readFileSync(paths[0] ?? '', 'utf8');
    const node = readFileSync(paths[1] ?? '', 'utf8');

    ok(shared.includes('export interface GeneratedInserts {'));
    ok(shared.includes('summary?: string | null;'));
    ok(shared.includes('rank?: number;'));
    ok(shared.includes('author?: string | null;'));
    ok(shared.includes('tags?: string[];'));
    ok(shared.includes('items?: { label: string }[];'));
    ok(node.includes('interface KnownInserts extends GeneratedInserts {}'));

    ok(shared.includes('export interface GeneratedUpdates {'));
    ok(shared.includes('title?: string;'));
    ok(shared.includes('items?: { UUID?: string; label: string }[];'));
    ok(node.includes('interface KnownUpdates extends GeneratedUpdates {}'));
  });

  it('narrows relation options in a consumer app, rejecting the illegal shapes', async () => {
    const app = join(root, 'relation-typing');
    writePackage(app, 'relation-typing');
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
      'collections/Users.ts',
      "import { defineCollection, field } from 'ohne';\n" +
        "export default defineCollection({ fields: { name: field('text') } });\n",
    );
    write(
      app,
      'collections/Posts.ts',
      "import { defineCollection, field } from 'ohne';\n" +
        'export default defineCollection({\n' +
        '  fields: {\n' +
        "    author: field('record', { collection: 'Users' }),\n" +
        "    tags: field('records', { collection: 'Tags' }),\n" +
        '  },\n' +
        '});\n',
    );
    write(
      app,
      'collections/Tags.ts',
      "import { defineCollection, field } from 'ohne';\n" +
        'export default defineCollection({\n' +
        "  fields: { posts: field('records', { collection: 'Posts', inverse: 'tags' }) },\n" +
        '});\n',
    );
    write(
      app,
      'typing.ts',
      "import { field } from 'ohne';\n" +
        '\n' +
        "field('record', { collection: 'Users', onDelete: 'cascade' });\n" +
        "field('records', { collection: 'Posts', inverse: 'tags' });\n" +
        '// @ts-expect-error an unknown collection is not a legal target\n' +
        "field('record', { collection: 'Ghost' });\n" +
        '// @ts-expect-error a records field has no column to constrain\n' +
        "field('records', { collection: 'Users', unique: true });\n" +
        '// @ts-expect-error a junction field is empty, never NULL\n' +
        "field('records', { collection: 'Users', nullable: true });\n" +
        '// @ts-expect-error `author` owns no junction on Posts\n' +
        "field('records', { collection: 'Posts', inverse: 'author' });\n" +
        '// @ts-expect-error a record field requires its options\n' +
        "field('record');\n" +
        '// @ts-expect-error a record column is force-nullable, so the option is hidden\n' +
        "field('record', { collection: 'Users', nullable: true });\n",
    );

    await loadLayers(app);
    await generateDatabase(app);

    execFileSync(
      process.execPath,
      [join(FRAMEWORK, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', app],
      { encoding: 'utf8' },
    );
  });

  it('narrows block names in a consumer app, rejecting the illegal shapes', async () => {
    const app = join(root, 'block-typing');
    writePackage(app, 'block-typing');
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
      'blocks/Hero.ts',
      "import { defineBlock, field } from 'ohne';\n" +
        'export default defineBlock({\n' +
        "  fields: { title: field('text'), banner: field('blocks', { allow: ['Hero'] }) },\n" +
        '});\n',
    );
    write(
      app,
      'blocks/CTA.ts',
      "import { defineBlock, field } from 'ohne';\n" +
        "export default defineBlock({ fields: { label: field('text') } });\n",
    );
    write(
      app,
      'collections/Pages.ts',
      "import { defineCollection, field } from 'ohne';\n" +
        'export default defineCollection({\n' +
        "  fields: { body: field('blocks'), hero: field('blocks', { allow: ['Hero'] }) },\n" +
        '});\n',
    );
    write(
      app,
      'typing.ts',
      "import type { KnownCollections } from 'ohne';\n" +
        '\n' +
        "import { field } from 'ohne';\n" +
        '\n' +
        "field('blocks');\n" +
        "field('blocks', { allow: ['Hero'] });\n" +
        '// @ts-expect-error an unknown block is not a legal type\n' +
        "field('blocks', { allow: ['Typo'] });\n" +
        '// @ts-expect-error a blocks field owns no column, so the commons are barred\n' +
        "field('blocks', { nullable: true });\n" +
        '\n' +
        "export function shape(page: KnownCollections['Pages']): string {\n" +
        '  const titles = page.hero.map((item) => item.fields.title);\n' +
        '  const labels = page.body.map((item) =>\n' +
        "    item.block === 'Hero' ? item.fields.title : item.fields.label,\n" +
        '  );\n' +
        "  return [...titles, ...labels].join(' ');\n" +
        '}\n',
    );

    await loadLayers(app);
    await generateDatabase(app);

    execFileSync(
      process.execPath,
      [join(FRAMEWORK, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', app],
      { encoding: 'utf8' },
    );
  });

  it('narrows migration address fields in a consumer app, staying open to any string', async () => {
    const app = join(root, 'migration-typing');
    writePackage(app, 'migration-typing');
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
      'collections/Todos.ts',
      "import { defineCollection, field } from 'ohne';\n" +
        "export default defineCollection({ fields: { title: field('text'), done: field('boolean') } });\n",
    );
    write(
      app,
      'typing.ts',
      "import { defineMigration, type Config, type MoveMigration } from 'ohne';\n" +
        '\n' +
        'defineMigration({\n' +
        "  from: { collection: 'Todos', field: 'title' },\n" +
        "  to: { collection: 'Todos', field: 'heading' },\n" +
        '});\n' +
        "defineMigration({ from: { collection: 'Todos', field: 'sections.title' }, to: null });\n" +
        "defineMigration({ from: { collection: 'Ghost', field: 'anything', type: 'text' }, to: null });\n" +
        '\n' +
        "const known: Extract<Extract<MoveMigration['from'], { collection: 'Todos' }>['field'], 'title'> =\n" +
        "  'title';\n" +
        '// @ts-expect-error an unknown collection has no dedicated member, so its fields never narrow\n' +
        "const unknown: Extract<Extract<MoveMigration['from'], { collection: 'Ghost' }>['field'], 'title'> =\n" +
        "  'title';\n" +
        '\n' +
        "type Disable = NonNullable<Config['disable']>;\n" +
        "const disabled: Extract<NonNullable<Disable['collections']>[number], 'Todos'> = 'Todos';\n" +
        "const open: NonNullable<Disable['collections']>[number] = 'Ghost';\n" +
        '// @ts-expect-error an unregistered name is never suggested\n' +
        "const ghost: Extract<NonNullable<Disable['collections']>[number], 'Ghost'> = 'Ghost';\n",
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
      "export default { fields: { rel: { type: 'gallery', options: {} } } };\n",
    );

    await loadLayers(app);
    await rejects(generateDatabase(app), /Unknown field type `gallery`/);
  });

  it('rejects a blocks field allowing an unknown block', async () => {
    const app = join(root, 'unknown-block');
    writePackage(app, 'unknown-block');
    write(app, 'blocks/Hero.ts', 'export default { fields: {} };\n');
    write(
      app,
      'collections/Pages.ts',
      "export default { fields: { body: { type: 'blocks', options: { allow: ['Ghost'] } } } };\n",
    );

    await loadLayers(app);
    await rejects(generateDatabase(app), /Unknown block `Ghost`/);
  });
});

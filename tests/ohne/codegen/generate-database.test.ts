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

  function stripDocs(source: string): string {
    return source.replace(/(?:^[ \t]*\n)?^[ \t]*\/\*\*[\s\S]*?\*\/\n/gm, '');
  }

  function section(source: string, name: string): string {
    const start = source.indexOf(`export interface ${name} {`);
    const end = source.indexOf('export interface', start + 1);
    return end === -1 ? source.slice(start) : source.slice(start, end);
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

    ok(out.includes("import { useMigrations } from 'ohnejs';"));
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
    ok(shared.includes('export interface GeneratedBlockQueryFields {}'));
    ok(shared.includes('export interface GeneratedBlockInserts {}'));
    ok(shared.includes('export interface GeneratedBlockUpdates {}'));
    ok(shared.includes('export interface GeneratedDatabases {}'));
    ok(shared.includes('export interface GeneratedSingletons {}'));
    ok(node.includes('interface KnownSingletons extends GeneratedSingletons {}'));
    ok(node.includes('interface KnownCollections extends GeneratedCollections {}'));
    ok(node.includes('interface KnownBlocks extends GeneratedBlocks {}'));
    ok(node.includes('interface KnownBlockQueryFields extends GeneratedBlockQueryFields {}'));
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

    ok(out.includes("import { useCollections, useFields } from 'ohnejs';"));
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
    const bare = stripDocs(readFileSync(paths[0] ?? '', 'utf8'));

    ok(
      bare.includes(
        '    address: {\n      UUID: string;\n      street: string;\n      city: string | null;\n    } | null;',
      ),
    );
    ok(
      bare.includes(
        '    sections: {\n      UUID: string;\n      title: string;\n      items: {\n        UUID: string;\n        label: string;\n      }[];\n    }[];',
      ),
    );
  });

  it('documents each field with a headline and resolved-config bullets', async () => {
    const app = join(root, 'field-docs');
    writePackage(app, 'field-docs');
    write(app, 'messages/promo/en.json', JSON.stringify({ tag: 'Tagline!' }));
    write(
      app,
      'blocks/Hero.ts',
      "export default { fields: { headline: { type: 'text', options: {} } } };\n",
    );
    write(
      app,
      'collections/Pages.ts',
      'export default { fields: {\n' +
        "  title: { type: 'text', options: { unique: true, description: 'The page title.', validators: [(v) => undefined] } },\n" +
        "  gallerySlider: { type: 'text', options: {} },\n" +
        "  intro: { type: 'text', options: { label: 'The intro', translatable: true } },\n" +
        "  tagline: { type: 'text', options: { label: 'promo.tag' } },\n" +
        "  notes: { type: 'text', options: { label: 'Notes', description: { text: 'Editor notes.', expanded: true } } },\n" +
        "  sections: { type: 'repeater', options: { fields: { heading: { type: 'text', options: {} } } } },\n" +
        "  banner: { type: 'blocks', options: { allow: ['Hero'] } },\n" +
        '} };\n',
    );

    await loadLayers(app);
    const paths = await generateDatabase(app);
    const shared = readFileSync(paths[0] ?? '', 'utf8');

    // Headline: description, else label, else the sentence-cased name; a message key resolves.
    // It ends with a period, unless it already closes with sentence punctuation.
    ok(shared.includes(' * The page title.'));
    ok(!shared.includes('The page title..'));
    ok(shared.includes(' * Gallery slider.'));
    ok(shared.includes(' * The intro.'));
    ok(shared.includes(' * Tagline!'));
    ok(!shared.includes('Tagline!.'));
    ok(shared.includes(' * Editor notes.'));
    ok(!shared.includes(' * Notes.'));

    // The resolved-config bullets, in the agreed vocabulary.
    ok(shared.includes(' * - Type: `text`'));
    ok(shared.includes(' * - Unique'));
    ok(shared.includes(' * - No index'));
    ok(shared.includes(' * - Not translatable'));
    ok(shared.includes(' * - Translatable'));
    ok(shared.includes(' * - 1 validator'));
    ok(shared.includes(' * - No condition'));
    ok(shared.includes(' * - `allowEmpty` is `false`'));
    ok(shared.includes(' * - `fields` has 1 entry'));

    // The built-in UUID and _updatedAt carry fixed docs.
    ok(shared.includes(" * This record's unique identifier."));
    ok(
      shared.includes(' * When this record was last updated, as a Unix timestamp in milliseconds.'),
    );

    // A nested subfield is documented too, but drops the top-level-only translatability line.
    const headingDoc = shared.slice(0, shared.indexOf('heading: string;')).split('/**').pop() ?? '';
    ok(headingDoc.includes(' * Heading'));
    ok(headingDoc.includes(' * - No index'));
    ok(!headingDoc.includes('translatable'));

    // A blocks-union arm documents its structural members and the item UUID.
    ok(shared.includes(' * The block type.'));
    ok(shared.includes(" * This block instance's unique identifier."));
    ok(shared.includes(" * The block's own fields."));
    ok(shared.includes(" * This item's unique identifier."));

    // Consecutive documented props are separated by a blank line.
    ok(shared.includes(';\n\n    /**'));

    // The docs reach the input shapes too, so a composite's subfields carry them in the insert shape.
    const inserts = shared.slice(shared.indexOf('export interface GeneratedInserts'));
    ok(inserts.includes(' * Heading'));
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

  it('marks translatable fields for query typing, the read folding null, the inputs untouched', async () => {
    const app = join(root, 'translations');
    writePackage(app, 'translations');
    write(
      app,
      'collections/Tags.ts',
      'export default { fields: {\n' +
        "  label: { type: 'text', options: {} },\n" +
        "  posts: { type: 'records', options: { collection: 'Posts', inverse: 'tags' } },\n" +
        '} };\n',
    );
    write(
      app,
      'collections/Posts.ts',
      'export default { fields: {\n' +
        "  title: { type: 'text', options: { translatable: true } },\n" +
        "  teaser: { type: 'text', options: { nullable: true, translatable: true } },\n" +
        "  tags: { type: 'records', options: { collection: 'Tags', translatable: true } },\n" +
        "  sections: { type: 'repeater', options: { translatable: true, fields: { heading: { type: 'text', options: {} } } } },\n" +
        '} };\n',
    );

    await loadLayers(app);
    const paths = await generateDatabase(app);
    const shared = readFileSync(paths[0] ?? '', 'utf8');

    ok(shared.includes('title: { scalar: string; companion: true };'));
    ok(shared.includes('teaser: { scalar: string; nullable: true; companion: true };'));
    ok(shared.includes("tags: { records: 'Tags'; localeScoped: true };"));
    ok(
      shared.includes(
        "sections: { child: 'many'; fields: { UUID: { scalar: string; id: true }; heading: { scalar: string } }; localeScoped: true };",
      ),
    );
    ok(shared.includes("posts: { records: 'Posts' };"));
    ok(shared.includes("    _translations: 'en'[];"));
    ok(shared.includes('    _translations: { translations: true };'));
    strictEqual(shared.split('_translations').length - 1, 2);

    ok(shared.includes('    title: string | null;'));
    ok(shared.includes('    teaser: string | null;'));
    ok(!shared.includes('| null | null'));

    ok(shared.includes('    title: string;'));
    ok(shared.includes('    teaser?: string | null;'));
    ok(shared.includes('    title?: string;'));

    ok(shared.includes('export interface GeneratedLocales {\n  en: true;\n}'));
  });

  it('emits one GeneratedLocales member per configured locale, canonicalized', async () => {
    const app = join(root, 'locales');
    writePackage(
      app,
      'locales',
      undefined,
      "export default { collections: { locales: ['en', 'de-at'], defaultLocale: 'en' } };\n",
    );

    await loadLayers(app);
    const paths = await generateDatabase(app);
    const shared = readFileSync(paths[0] ?? '', 'utf8');
    const node = readFileSync(paths[1] ?? '', 'utf8');

    ok(shared.includes("export interface GeneratedLocales {\n  en: true;\n  'de-AT': true;\n}"));
    ok(node.includes('interface KnownLocales extends GeneratedLocales {}'));
  });

  it('derives GeneratedCapabilities from the collection set, wildcards included', async () => {
    const app = join(root, 'capabilities');
    writePackage(app, 'capabilities');
    write(app, 'collections/Posts.ts', 'export default { fields: {} };\n');
    write(app, 'collections/Authors.ts', 'export default { fields: {} };\n');

    await loadLayers(app);
    const paths = await generateDatabase(app);
    const shared = readFileSync(paths[0] ?? '', 'utf8');
    const node = readFileSync(paths[1] ?? '', 'utf8');

    const capabilities = section(shared, 'GeneratedCapabilities');
    ok(capabilities.includes("'*': true;"));
    ok(capabilities.includes("'collection.*': true;"));
    for (const operation of ['read', 'create', 'update', 'delete']) {
      ok(capabilities.includes(`'collection.Posts.${operation}': true;`));
      ok(capabilities.includes(`'collection.Authors.${operation}': true;`));
    }
    ok(capabilities.includes("'collection.Posts.*': true;"));
    ok(capabilities.includes("'collection.Authors.*': true;"));
    ok(node.includes('interface KnownCapabilities extends GeneratedCapabilities {}'));
  });

  it('lists a singleton in GeneratedSingletons and drops its create and delete capabilities', async () => {
    const app = join(root, 'singletons');
    writePackage(app, 'singletons');
    write(app, 'collections/Posts.ts', 'export default { fields: {} };\n');
    write(app, 'collections/Settings.ts', 'export default { singleton: true, fields: {} };\n');

    await loadLayers(app);
    const paths = await generateDatabase(app);
    const shared = readFileSync(paths[0] ?? '', 'utf8');

    ok(shared.includes('export interface GeneratedSingletons {\n  Settings: true;\n}'));
    const capabilities = section(shared, 'GeneratedCapabilities');
    ok(capabilities.includes("'collection.Settings.read': true;"));
    ok(capabilities.includes("'collection.Settings.update': true;"));
    ok(capabilities.includes("'collection.Settings.*': true;"));
    ok(!capabilities.includes("'collection.Settings.create'"));
    ok(!capabilities.includes("'collection.Settings.delete'"));
    ok(capabilities.includes("'collection.Posts.create': true;"));
  });

  it('emits only the wildcard capabilities when there are no collections', async () => {
    const app = join(root, 'capabilities-empty');
    writePackage(app, 'capabilities-empty');

    await loadLayers(app);
    const paths = await generateDatabase(app);
    const shared = readFileSync(paths[0] ?? '', 'utf8');

    const capabilities = section(shared, 'GeneratedCapabilities');
    ok(capabilities.includes("'*': true;"));
    ok(capabilities.includes("'collection.*': true;"));
    ok(!capabilities.includes('collection.Posts'));
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
    const bare = stripDocs(readFileSync(paths[0] ?? '', 'utf8'));
    const node = readFileSync(paths[1] ?? '', 'utf8');

    ok(bare.includes('export interface GeneratedBlocks {'));
    ok(bare.includes('  CTA: {\n    label: string;\n    url: string | null;\n  };'));
    ok(bare.includes('  Hero: {\n    title: string;\n  };'));
    ok(
      bare.includes(
        '    hero: {\n' +
          "      block: 'Hero';\n" +
          '      UUID: string;\n' +
          "      fields: GeneratedBlocks['Hero'];\n" +
          '    }[];',
      ),
    );
    ok(
      bare.includes(
        '    body: (\n' +
          '      | {\n' +
          "          block: 'CTA';\n" +
          '          UUID: string;\n' +
          "          fields: GeneratedBlocks['CTA'];\n" +
          '        }\n' +
          '      | {\n' +
          "          block: 'Hero';\n" +
          '          UUID: string;\n' +
          "          fields: GeneratedBlocks['Hero'];\n" +
          '        }\n' +
          '    )[];',
      ),
    );
    ok(bare.includes("    body: { blocks: 'CTA' | 'Hero' };"));
    ok(bare.includes("    hero: { blocks: 'Hero' };"));
    ok(
      bare.includes(
        'export interface GeneratedBlockQueryFields {\n' +
          '  CTA: {\n' +
          '    UUID: { scalar: string; id: true };\n' +
          '    label: { scalar: string };\n' +
          '    url: { scalar: string; nullable: true };\n' +
          '  };\n' +
          '  Hero: {\n' +
          '    UUID: { scalar: string; id: true };\n' +
          '    title: { scalar: string };\n' +
          '  };\n' +
          '}',
      ),
    );
    ok(node.includes('interface KnownBlockQueryFields extends GeneratedBlockQueryFields {}'));
    ok(node.includes("import { useCollections, useBlocks } from 'ohnejs';"));
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
    const bare = stripDocs(readFileSync(paths[0] ?? '', 'utf8'));

    ok(
      bare.includes(
        '    cards: {\n' +
          "      block: 'CTA';\n" +
          '      UUID: string;\n' +
          "      fields: GeneratedBlocks['CTA'];\n" +
          '    }[];',
      ),
    );
    ok(
      bare.includes(
        '    more: {\n' +
          "      block: 'Hero';\n" +
          '      UUID: string;\n' +
          "      fields: GeneratedBlocks['Hero'];\n" +
          '    }[];',
      ),
    );
    ok(
      bare.includes(
        '  Hero: {\n' +
          '    UUID: { scalar: string; id: true };\n' +
          "    cards: { blocks: 'CTA' };\n" +
          "    more: { blocks: 'Hero' };\n" +
          '  };',
      ),
    );
  });

  it('types blocks fields into the query, insert, and update vocabularies', async () => {
    const app = join(root, 'blocks-vocabulary');
    writePackage(app, 'blocks-vocabulary');
    write(
      app,
      'collections/Users.ts',
      "export default { fields: { name: { type: 'text', options: {} } } };\n",
    );
    write(
      app,
      'blocks/CTA.ts',
      'export default { fields: {\n' +
        "  label: { type: 'text', options: {} },\n" +
        "  note: { type: 'text', options: { nullable: true } },\n" +
        "  author: { type: 'record', options: { collection: 'Users' } },\n" +
        '} };\n',
    );
    write(
      app,
      'blocks/Hero.ts',
      'export default { fields: {\n' +
        "  title: { type: 'text', options: {} },\n" +
        "  more: { type: 'blocks', options: { allow: ['Hero'] } },\n" +
        '} };\n',
    );
    write(
      app,
      'collections/Pages.ts',
      'export default { fields: {\n' +
        "  body: { type: 'blocks', options: {} },\n" +
        "  banner: { type: 'blocks', options: { allow: ['Hero'], translatable: true } },\n" +
        "  kind: { type: 'text', options: {} },\n" +
        "  promo: { type: 'blocks', options: { allow: ['CTA'], when: { kind: 'sale' } } },\n" +
        '} };\n',
    );

    await loadLayers(app);
    const paths = await generateDatabase(app);
    const shared = stripDocs(readFileSync(paths[0] ?? '', 'utf8'));

    ok(shared.includes("    body: { blocks: 'CTA' | 'Hero' };"));
    ok(shared.includes("    banner: { blocks: 'Hero'; localeScoped: true };"));
    ok(shared.includes("    promo: { blocks: 'CTA'; when: { kind: 'sale' } };"));
    ok(
      shared.includes(
        'export interface GeneratedBlockQueryFields {\n' +
          '  CTA: {\n' +
          '    UUID: { scalar: string; id: true };\n' +
          '    label: { scalar: string };\n' +
          '    note: { scalar: string; nullable: true };\n' +
          "    author: { scalar: string; record: 'Users'; nullable: true };\n" +
          '  };\n' +
          '  Hero: {\n' +
          '    UUID: { scalar: string; id: true };\n' +
          '    title: { scalar: string };\n' +
          "    more: { blocks: 'Hero' };\n" +
          '  };\n' +
          '}',
      ),
    );

    ok(
      shared.includes(
        '    body?: (\n' +
          '      | {\n' +
          "          block: 'CTA';\n" +
          "          fields: GeneratedBlockInserts['CTA'];\n" +
          '        }\n' +
          '      | {\n' +
          "          block: 'Hero';\n" +
          "          fields: GeneratedBlockInserts['Hero'];\n" +
          '        }\n' +
          '    )[];',
      ),
    );
    ok(
      shared.includes(
        '    banner?: {\n' +
          "      block: 'Hero';\n" +
          "      fields: GeneratedBlockInserts['Hero'];\n" +
          '    }[];',
      ),
    );
    ok(
      shared.includes(
        'export interface GeneratedBlockInserts {\n' +
          '  CTA: {\n' +
          '    label: string;\n' +
          '    note?: string | null;\n' +
          '    author?: string | null;\n' +
          '  };\n' +
          '  Hero: {\n' +
          '    title: string;\n' +
          '    more?: {\n' +
          "      block: 'Hero';\n" +
          "      fields: GeneratedBlockInserts['Hero'];\n" +
          '    }[];\n' +
          '  };\n' +
          '}',
      ),
    );

    ok(
      shared.includes(
        '    body?: (\n' +
          '      | {\n' +
          "          block: 'CTA';\n" +
          '          UUID?: string;\n' +
          "          fields: GeneratedBlockUpdates['CTA'];\n" +
          '        }\n' +
          '      | {\n' +
          "          block: 'Hero';\n" +
          '          UUID?: string;\n' +
          "          fields: GeneratedBlockUpdates['Hero'];\n" +
          '        }\n' +
          '    )[];',
      ),
    );
    ok(
      shared.includes(
        '    banner?: {\n' +
          "      block: 'Hero';\n" +
          '      UUID?: string;\n' +
          "      fields: GeneratedBlockUpdates['Hero'];\n" +
          '    }[];',
      ),
    );
    ok(
      shared.includes(
        'export interface GeneratedBlockUpdates {\n' +
          '  CTA: {\n' +
          '    label: string;\n' +
          '    note?: string | null;\n' +
          '    author?: string | null;\n' +
          '  };\n' +
          '  Hero: {\n' +
          '    title: string;\n' +
          '    more?: {\n' +
          "      block: 'Hero';\n" +
          '      UUID?: string;\n' +
          "      fields: GeneratedBlockUpdates['Hero'];\n" +
          '    }[];\n' +
          '  };\n' +
          '}',
      ),
    );
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
    const shared = stripDocs(readFileSync(paths[0] ?? '', 'utf8'));
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
    const shared = stripDocs(readFileSync(paths[0] ?? '', 'utf8'));
    const node = readFileSync(paths[1] ?? '', 'utf8');

    ok(
      shared.includes(
        '    body: {\n' +
          "      block: 'Hero';\n" +
          '      UUID: string;\n' +
          "      fields: GeneratedBlocks['Hero'];\n" +
          '    }[];',
      ),
    );
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
    symlinkSync(FRAMEWORK, join(app, 'node_modules', 'ohnejs'), 'dir');
    symlinkSync(
      join(FRAMEWORK, 'node_modules', '@types', 'node'),
      join(app, 'node_modules', '@types', 'node'),
      'dir',
    );
    writeFileSync(
      join(app, 'tsconfig.json'),
      JSON.stringify({
        extends: 'ohnejs/tsconfig.node.json',
        include: ['**/*.ts', '.ohne/shared/**/*.ts', '.ohne/node/**/*.ts'],
      }),
    );
    write(
      app,
      'fields/status.ts',
      "import { defineField, option } from 'ohnejs';\n" +
        'export default defineField({\n' +
        "  columnType: 'text',\n" +
        "  options: { choices: option<string[]>({ required: true }), initial: option({ default: 'open' }) },\n" +
        "  emitType: (ctx) => ctx.options.choices.map((choice) => `'${choice}'`).join(' | '),\n" +
        '});\n',
    );
    write(
      app,
      'fields/labels.ts',
      "import { defineField } from 'ohnejs';\n" +
        'export default defineField({\n' +
        "  columnType: 'json',\n" +
        '  jsonList: true,\n' +
        '  forceNullable: true,\n' +
        "  emitType: () => 'string[]',\n" +
        '});\n',
    );
    write(
      app,
      'collections/People.ts',
      "import { defineCollection, field } from 'ohnejs';\n" +
        'export default defineCollection({\n' +
        '  fields: {\n' +
        "    name: field('text'),\n" +
        "    apiKey: field('text', { readable: false, nullable: true }),\n" +
        '  },\n' +
        '});\n',
    );
    write(
      app,
      'collections/Todos.ts',
      "import { defineCollection, field } from 'ohnejs';\n" +
        'export default defineCollection({\n' +
        '  fields: {\n' +
        "    title: field('text', { unique: true }),\n" +
        "    status: field('status', { choices: ['open', 'done'] }),\n" +
        "    meta: field('object', { fields: { color: field('text', { nullable: true }) } }),\n" +
        "    checklist: field('repeater', { fields: { label: field('text'), done: field('boolean') } }),\n" +
        "    labels: field('labels'),\n" +
        "    owner: field('record', { collection: 'People' }),\n" +
        "    secret: field('text', { readable: false }),\n" +
        "    token: field('text', { writable: false, nullable: true }),\n" +
        "    locked: field('text', { immutable: true }),\n" +
        '  },\n' +
        "  compositeIndexes: [{ fields: ['title', 'status'] }],\n" +
        '});\n',
    );
    write(
      app,
      'typing.ts',
      "import type { KnownCollections, KnownInserts, KnownUpdates, PluckValue, QueryRow } from 'ohnejs';\n" +
        '\n' +
        "import { query } from 'ohnejs';\n" +
        '\n' +
        "export function shape(todo: KnownCollections['Todos']): string {\n" +
        '  const labels = todo.checklist.map((item) => (item.done ? item.label : item.label.toUpperCase()));\n' +
        "  const color = todo.meta === null ? 'none' : (todo.meta.color ?? 'unset');\n" +
        "  return [todo.status, color, todo.secret, ...labels].join(' ');\n" +
        '}\n' +
        '// @ts-expect-error a repeater list is never null\n' +
        "export const bad: KnownCollections['Todos']['checklist'] = null;\n" +
        '\n' +
        'export function flags(\n' +
        "  row: QueryRow<'Todos'>,\n" +
        "  picked: QueryRow<'Todos', 'secret' | 'title'>,\n" +
        '): string {\n' +
        '  // @ts-expect-error a write-only field is absent without an explicit select\n' +
        '  const hidden: string = row.secret;\n' +
        "  return [hidden, picked.secret, row.title].join(' ');\n" +
        '}\n' +
        "export function populated(row: QueryRow<'Todos', never, 'owner'>): string {\n" +
        "  if (row.owner === null) return 'none';\n" +
        '  // @ts-expect-error a write-only field is absent from a populated target\n' +
        '  const leak: string = row.owner.apiKey;\n' +
        "  return [row.owner.name, leak].join(' ');\n" +
        '}\n' +
        "export const plucked: PluckValue<'Todos', 'secret', never> = 'hash';\n" +
        'export function fluent(): void {\n' +
        "  query('Todos').where('labels', (w) => w.includes('a'));\n" +
        "  query('Todos').where('labels', (w) => w.includesAll(['a', 'b']));\n" +
        "  query('Todos').where('labels', (w) => w.includesAny(['a', 'b']));\n" +
        '  // @ts-expect-error list membership needs a `jsonList` column\n' +
        "  query('Todos').where('title', (w) => w.includes('a'));\n" +
        "  query('Todos').where('secret', (w) => w.contains('x'));\n" +
        "  query('Todos').orderBy('secret').select('secret', 'title');\n" +
        '}\n' +
        "export const insertLocked: KnownInserts['Todos']['locked'] = 'pin';\n" +
        '// @ts-expect-error a writable: false field is absent from the insert input\n' +
        "export const insertToken: KnownInserts['Todos']['token'] = null;\n" +
        "export const updateTitle: KnownUpdates['Todos']['title'] = 'renamed';\n" +
        '// @ts-expect-error an immutable field is absent from the update input\n' +
        "export const updateLocked: KnownUpdates['Todos']['locked'] = 'moved';\n" +
        '// @ts-expect-error a writable: false field is absent from the update input\n' +
        "export const updateToken: KnownUpdates['Todos']['token'] = null;\n",
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
    const shared = stripDocs(readFileSync(paths[0] ?? '', 'utf8'));
    const node = readFileSync(paths[1] ?? '', 'utf8');

    ok(shared.includes('export interface GeneratedInserts {'));
    ok(shared.includes('summary?: string | null;'));
    ok(shared.includes('rank?: number;'));
    ok(shared.includes('author?: string | null;'));
    ok(shared.includes('tags?: string[];'));
    ok(shared.includes('    items?: {\n      label: string;\n    }[];'));
    ok(node.includes('interface KnownInserts extends GeneratedInserts {}'));

    ok(shared.includes('export interface GeneratedUpdates {'));
    ok(shared.includes('title?: string;'));
    ok(shared.includes('    items?: {\n      UUID?: string;\n      label: string;\n    }[];'));
    ok(node.includes('interface KnownUpdates extends GeneratedUpdates {}'));
  });

  it('keeps a write-only field in the record, marking its query entry', async () => {
    const app = join(root, 'hidden-field');
    writePackage(app, 'hidden-field');
    write(
      app,
      'collections/Vault.ts',
      'export default { fields: {\n' +
        "  name: { type: 'text', options: {} },\n" +
        "  secret: { type: 'text', options: { readable: false } },\n" +
        '} };\n',
    );

    await loadLayers(app);
    const paths = await generateDatabase(app);
    const bare = stripDocs(readFileSync(paths[0] ?? '', 'utf8'));

    ok(section(bare, 'GeneratedCollections').includes('    secret: string;'));
    ok(bare.includes('secret: { scalar: string; readable: false };'));
  });

  it('drops a writable: false field from both write inputs, the record keeping it', async () => {
    const app = join(root, 'unwritable');
    writePackage(app, 'unwritable');
    write(
      app,
      'collections/Sessions.ts',
      'export default { fields: {\n' +
        "  device: { type: 'text', options: {} },\n" +
        "  token: { type: 'text', options: { writable: false, nullable: true } },\n" +
        '} };\n',
    );

    await loadLayers(app);
    const paths = await generateDatabase(app);
    const bare = stripDocs(readFileSync(paths[0] ?? '', 'utf8'));
    const inserts = section(bare, 'GeneratedInserts');
    const updates = section(bare, 'GeneratedUpdates');

    ok(section(bare, 'GeneratedCollections').includes('    token: string | null;'));
    ok(inserts.includes('device: string;'));
    ok(!inserts.includes('token'));
    ok(updates.includes('device?: string;'));
    ok(!updates.includes('token'));
  });

  it('keeps an immutable field in inserts, dropping it from updates', async () => {
    const app = join(root, 'immutable-field');
    writePackage(app, 'immutable-field');
    write(
      app,
      'collections/Orders.ts',
      'export default { fields: {\n' +
        "  note: { type: 'text', options: {} },\n" +
        "  reference: { type: 'text', options: { immutable: true } },\n" +
        '} };\n',
    );

    await loadLayers(app);
    const paths = await generateDatabase(app);
    const bare = stripDocs(readFileSync(paths[0] ?? '', 'utf8'));
    const updates = section(bare, 'GeneratedUpdates');

    ok(section(bare, 'GeneratedInserts').includes('    reference: string;'));
    ok(updates.includes('note?: string;'));
    ok(!updates.includes('reference'));
  });

  it('drops hidden subfields from composite and block read shapes, the query markers kept', async () => {
    const app = join(root, 'hidden-nested');
    writePackage(app, 'hidden-nested');
    write(
      app,
      'blocks/Teaser.ts',
      'export default { fields: {\n' +
        "  headline: { type: 'text', options: {} },\n" +
        "  internal: { type: 'text', options: { readable: false } },\n" +
        '} };\n',
    );
    write(
      app,
      'collections/Profiles.ts',
      'export default { fields: {\n' +
        "  profile: { type: 'object', options: { fields: {\n" +
        "    bio: { type: 'text', options: {} },\n" +
        "    pin: { type: 'text', options: { readable: false } },\n" +
        '  } } },\n' +
        '} };\n',
    );

    await loadLayers(app);
    const paths = await generateDatabase(app);
    const bare = stripDocs(readFileSync(paths[0] ?? '', 'utf8'));
    const blocks = section(bare, 'GeneratedBlocks');

    ok(bare.includes('    profile: {\n      UUID: string;\n      bio: string;\n    } | null;'));
    ok(!section(bare, 'GeneratedCollections').includes('pin'));
    ok(bare.includes('pin: { scalar: string; readable: false }'));
    ok(blocks.includes('  Teaser: {\n    headline: string;\n  };'));
    ok(!blocks.includes('internal'));
    ok(
      section(bare, 'GeneratedBlockQueryFields').includes(
        'internal: { scalar: string; readable: false };',
      ),
    );
  });

  it('marks a json-list field type in GeneratedQueryFields', async () => {
    const app = join(root, 'json-list');
    writePackage(app, 'json-list');
    write(
      app,
      'fields/taglist.ts',
      "export default { columnType: 'json', jsonList: true, forceNullable: true };\n",
    );
    write(
      app,
      'collections/Media.ts',
      "export default { fields: { labels: { type: 'taglist', options: {} } } };\n",
    );

    await loadLayers(app);
    const paths = await generateDatabase(app);
    const shared = readFileSync(paths[0] ?? '', 'utf8');

    ok(shared.includes('labels: { scalar: unknown; nullable: true; jsonList: true };'));
  });

  it('narrows relation options in a consumer app, rejecting the illegal shapes', async () => {
    const app = join(root, 'relation-typing');
    writePackage(app, 'relation-typing');
    mkdirSync(join(app, 'node_modules', '@types'), { recursive: true });
    symlinkSync(FRAMEWORK, join(app, 'node_modules', 'ohnejs'), 'dir');
    symlinkSync(
      join(FRAMEWORK, 'node_modules', '@types', 'node'),
      join(app, 'node_modules', '@types', 'node'),
      'dir',
    );
    writeFileSync(
      join(app, 'tsconfig.json'),
      JSON.stringify({
        extends: 'ohnejs/tsconfig.node.json',
        include: ['**/*.ts', '.ohne/shared/**/*.ts', '.ohne/node/**/*.ts'],
      }),
    );
    write(
      app,
      'collections/Users.ts',
      "import { defineCollection, field } from 'ohnejs';\n" +
        "export default defineCollection({ fields: { name: field('text') } });\n",
    );
    write(
      app,
      'collections/Posts.ts',
      "import { defineCollection, field } from 'ohnejs';\n" +
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
      "import { defineCollection, field } from 'ohnejs';\n" +
        'export default defineCollection({\n' +
        "  fields: { posts: field('records', { collection: 'Posts', inverse: 'tags' }) },\n" +
        '});\n',
    );
    write(
      app,
      'typing.ts',
      "import { field } from 'ohnejs';\n" +
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
    symlinkSync(FRAMEWORK, join(app, 'node_modules', 'ohnejs'), 'dir');
    symlinkSync(
      join(FRAMEWORK, 'node_modules', '@types', 'node'),
      join(app, 'node_modules', '@types', 'node'),
      'dir',
    );
    writeFileSync(
      join(app, 'tsconfig.json'),
      JSON.stringify({
        extends: 'ohnejs/tsconfig.node.json',
        include: ['**/*.ts', '.ohne/shared/**/*.ts', '.ohne/node/**/*.ts'],
      }),
    );
    write(
      app,
      'blocks/Hero.ts',
      "import { defineBlock, field } from 'ohnejs';\n" +
        'export default defineBlock({\n' +
        "  fields: { title: field('text'), banner: field('blocks', { allow: ['Hero'] }) },\n" +
        '});\n',
    );
    write(
      app,
      'blocks/CTA.ts',
      "import { defineBlock, field } from 'ohnejs';\n" +
        "export default defineBlock({ fields: { label: field('text') } });\n",
    );
    write(
      app,
      'collections/Pages.ts',
      "import { defineCollection, field } from 'ohnejs';\n" +
        'export default defineCollection({\n' +
        "  fields: { body: field('blocks'), hero: field('blocks', { allow: ['Hero'] }) },\n" +
        '});\n',
    );
    write(
      app,
      'typing.ts',
      "import type { KnownCollections } from 'ohnejs';\n" +
        '\n' +
        "import { field } from 'ohnejs';\n" +
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
        '  const ids = page.body.map((item) => {\n' +
        '    const id: string = item.UUID;\n' +
        '    return id;\n' +
        '  });\n' +
        "  return [...titles, ...ids, ...labels].join(' ');\n" +
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
    symlinkSync(FRAMEWORK, join(app, 'node_modules', 'ohnejs'), 'dir');
    symlinkSync(
      join(FRAMEWORK, 'node_modules', '@types', 'node'),
      join(app, 'node_modules', '@types', 'node'),
      'dir',
    );
    writeFileSync(
      join(app, 'tsconfig.json'),
      JSON.stringify({
        extends: 'ohnejs/tsconfig.node.json',
        include: ['**/*.ts', '.ohne/shared/**/*.ts', '.ohne/node/**/*.ts'],
      }),
    );
    write(
      app,
      'collections/Todos.ts',
      "import { defineCollection, field } from 'ohnejs';\n" +
        "export default defineCollection({ fields: { title: field('text'), done: field('boolean') } });\n",
    );
    write(
      app,
      'typing.ts',
      "import { defineMigration, type Config, type MoveMigration } from 'ohnejs';\n" +
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

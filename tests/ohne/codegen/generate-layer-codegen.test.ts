import { deepStrictEqual, rejects, strictEqual } from 'node:assert';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';

import { BANNER } from '../../../src/ohne/codegen/codegen-dir.ts';
import {
  generateLayerCodegen,
  loadLayers,
  useCollections,
  useLayers,
  useRoles,
} from '../../../src/ohne/index.ts';

const ohne = new URL('../../../src/ohne/index.ts', import.meta.url).href;
const base = new URL('../../../src/base/fields/', import.meta.url).href;

describe('generateLayerCodegen', { skip: process.platform === 'win32' }, () => {
  let root: string;

  function entry(file: string, code: string): string {
    return `{ bucket: 'node', file: '${file}', code: () => ${code} }`;
  }

  function pathEntry(path: string, code: string): string {
    return `{ path: () => ${path}, code: (context) => ${code} }`;
  }

  function write(dir: string, relative: string, content: string): void {
    const file = join(dir, relative);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, content);
  }

  function writeLayer(dir: string, name: string, entries: string[], deps: string[] = []): void {
    mkdirSync(dir, { recursive: true });
    const dependencies = Object.fromEntries(deps.map((dep) => [dep, '*']));
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name, type: 'module', dependencies }),
    );
    writeFileSync(
      join(dir, 'ohne.config.ts'),
      `export default ${JSON.stringify({ layers: deps })}\n`,
    );
    writeFileSync(
      join(dir, 'ohne.layer.ts'),
      `import { defineLayer, useConfig, useCollections, useMessages, useRoles } from '${ohne}';\n` +
        `import roles from '${base}roles.ts';\n` +
        `import language from '${base}language.ts';\n\n` +
        `export default defineLayer({ codegen: [${entries.join(', ')}] });\n`,
    );
  }

  function link(consumer: string, name: string): void {
    const modules = join(consumer, 'node_modules');
    mkdirSync(modules, { recursive: true });
    symlinkSync(join(root, 'store', name), join(modules, name), 'dir');
  }

  before(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'ohne-gen-layer-codegen-')));
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  afterEach(() => {
    useLayers().clear();
  });

  it('writes each entry into its bucket with the banner and returns the paths', async () => {
    const app = join(root, 'app');
    writeLayer(app, 'app', [entry('fixture.ts', "'export const fixture = 1;\\n'")]);
    await loadLayers(app);

    const written = await generateLayerCodegen(app);
    deepStrictEqual(written, [join(app, '.ohne', 'node', 'fixture.ts')]);
    strictEqual(readFileSync(written[0]!, 'utf8'), `${BANNER}\nexport const fixture = 1;\n`);
  });

  it('leaves an unchanged file untouched on a rerun', async () => {
    const app = join(root, 'rerun');
    writeLayer(app, 'rerun', [entry('fixture.ts', "'export const fixture = 1;\\n'")]);
    await loadLayers(app);

    const [file] = await generateLayerCodegen(app);
    const before = statSync(file!).mtimeMs;
    deepStrictEqual(await generateLayerCodegen(app), [file]);
    strictEqual(statSync(file!).mtimeMs, before);
    strictEqual(readFileSync(file!, 'utf8'), `${BANNER}\nexport const fixture = 1;\n`);
  });

  it('runs code against the loaded stack, so it reads the merged config', async () => {
    const app = join(root, 'config');
    writeLayer(app, 'config', [
      entry('silent.ts', '`export const silent = ${useConfig().printer.silent};\\n`'),
    ]);
    writeFileSync(join(app, 'ohne.config.ts'), 'export default { printer: { silent: true } }\n');
    await loadLayers(app);

    const [file] = await generateLayerCodegen(app);
    strictEqual(readFileSync(file!, 'utf8'), `${BANNER}\nexport const silent = true;\n`);
  });

  it('throws when two layers claim the same file', async () => {
    writeLayer(join(root, 'store', 'base'), 'base', [entry('fixture.ts', "''")]);
    const app = join(root, 'twice');
    writeLayer(app, 'twice', [entry('fixture.ts', "''")], ['base']);
    link(app, 'base');
    await loadLayers(app);

    await rejects(generateLayerCodegen(app), /Codegen file `fixture.ts` is claimed twice/);
  });

  it('throws when a layer claims a file ohne generates itself', async () => {
    const app = join(root, 'reserved');
    writeLayer(app, 'reserved', [entry('routes.ts', "''")]);
    await loadLayers(app);

    await rejects(generateLayerCodegen(app), /Codegen file `routes.ts` is reserved/);
  });

  it('throws when a file is not a plain .ts name', async () => {
    const app = join(root, 'nested');
    writeLayer(app, 'nested', [entry('sub/fixture.ts', "''")]);
    await loadLayers(app);

    await rejects(generateLayerCodegen(app), /Invalid codegen file `sub\/fixture.ts`/);
  });

  it('writes a path entry relative to the app, without the banner', async () => {
    const app = join(root, 'path');
    writeLayer(app, 'path', [pathEntry("'../web/types.ts'", "'export type A = 1;\\n'")]);
    await loadLayers(app);

    const out = join(root, 'web', 'types.ts');
    deepStrictEqual(await generateLayerCodegen(app, { paths: true }), [out]);
    strictEqual(readFileSync(out, 'utf8'), 'export type A = 1;\n');
  });

  it('skips a path entry whose path is undefined', async () => {
    const app = join(root, 'unset');
    writeLayer(app, 'unset', [pathEntry('undefined', "'never'")]);
    await loadLayers(app);

    deepStrictEqual(await generateLayerCodegen(app, { paths: true }), []);
  });

  it('skips every path entry unless paths is on, still writing bucket entries', async () => {
    const app = join(root, 'serving');
    writeLayer(app, 'serving', [entry('fixture.ts', "''"), pathEntry("'out/types.ts'", "'x'")]);
    await loadLayers(app);

    deepStrictEqual(await generateLayerCodegen(app), [join(app, '.ohne', 'node', 'fixture.ts')]);
    strictEqual(existsSync(join(app, 'out', 'types.ts')), false);
  });

  it('passes fresh to code', async () => {
    const app = join(root, 'fresh');
    writeLayer(app, 'fresh', [pathEntry("'fresh.txt'", 'String(context.fresh)')]);
    await loadLayers(app);

    await generateLayerCodegen(app, { fresh: true, paths: true });
    strictEqual(readFileSync(join(app, 'fresh.txt'), 'utf8'), 'true');
  });

  it('throws when two layers claim the same path', async () => {
    writeLayer(join(root, 'store', 'pathbase'), 'pathbase', [pathEntry("'shared.ts'", "''")]);
    const app = join(root, 'pathtwice');
    writeLayer(app, 'pathtwice', [pathEntry("'shared.ts'", "''")], ['pathbase']);
    link(app, 'pathbase');
    await loadLayers(app);

    await rejects(
      generateLayerCodegen(app, { paths: true }),
      /Codegen file `shared.ts` is claimed twice/,
    );
  });

  it('throws when a path lands inside the codegen directory', async () => {
    const app = join(root, 'inside');
    writeLayer(app, 'inside', [pathEntry("'.ohne/mine.ts'", "''")]);
    await loadLayers(app);

    await rejects(
      generateLayerCodegen(app, { paths: true }),
      /Codegen path `.ohne\/mine.ts` is inside the codegen directory/,
    );
  });

  it('fills the registries from the stack while code runs, then restores them', async () => {
    const app = join(root, 'registries');
    writeLayer(app, 'registries', [
      pathEntry(
        "'schema.json'",
        'JSON.stringify([useRoles().keys(), useMessages().keys(), useCollections().keys()])',
      ),
    ]);
    write(app, 'roles/editor.ts', 'export default { capabilities: [] };\n');
    write(app, 'messages/de.json', '{ "hi": "Hallo" }\n');
    write(app, 'collections/Posts.ts', "export default { fields: { title: { type: 'text' } } };\n");
    await loadLayers(app);

    await generateLayerCodegen(app, { paths: true });
    deepStrictEqual(JSON.parse(readFileSync(join(app, 'schema.json'), 'utf8')), [
      ['editor'],
      ['de'],
      ['Posts'],
    ]);
    deepStrictEqual(useRoles().keys(), []);
    deepStrictEqual(useCollections().keys(), []);
  });

  it('lets the base roles and language types read the stack in emitJSONType', async () => {
    const app = join(root, 'json-types');
    const ctx = "{ name: 'x', options: {}, importType: () => '' }";
    writeLayer(app, 'json-types', [
      pathEntry(
        "'json-types.txt'",
        `[roles.emitJSONType(${ctx}), language.emitJSONType(${ctx})].join('\\n')`,
      ),
    ]);
    write(app, 'roles/admin.ts', "export default { capabilities: ['*'] };\n");
    write(app, 'roles/editor.ts', 'export default { capabilities: [] };\n');
    write(app, 'messages/en.json', '{ "hi": "Hi" }\n');
    write(app, 'messages/de.json', '{ "hi": "Hallo" }\n');
    await loadLayers(app);

    await generateLayerCodegen(app, { paths: true });
    strictEqual(
      readFileSync(join(app, 'json-types.txt'), 'utf8'),
      "('admin' | 'editor')[]\n'de' | 'en'",
    );
  });

  it('returns an empty list when no package.json is found', async () => {
    deepStrictEqual(await generateLayerCodegen(join(root, 'nowhere')), []);
  });
});

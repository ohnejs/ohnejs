import { deepStrictEqual, rejects, strictEqual } from 'node:assert';
import {
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
import { generateLayerCodegen, loadLayers, useLayers } from '../../../src/ohne/index.ts';

const ohne = new URL('../../../src/ohne/index.ts', import.meta.url).href;

describe('generateLayerCodegen', { skip: process.platform === 'win32' }, () => {
  let root: string;

  function entry(file: string, code: string): string {
    return `{ bucket: 'node', file: '${file}', code: () => ${code} }`;
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
      `import { defineLayer, useConfig } from '${ohne}';\n\n` +
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

  it('returns an empty list when no package.json is found', async () => {
    deepStrictEqual(await generateLayerCodegen(join(root, 'nowhere')), []);
  });
});

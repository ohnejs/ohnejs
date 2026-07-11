import { deepStrictEqual, rejects } from 'node:assert';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';

import { collectBlocks, loadLayers, useLayers } from '../../../src/ohne/index.ts';
import { stackedLayers } from '../../../src/ohne/layers/stacked-layers.ts';

describe('collectBlocks', () => {
  let root: string;

  function writePackage(at: string, name: string, config: string, layers?: string[]): void {
    mkdirSync(at, { recursive: true });
    const dependencies = Object.fromEntries((layers ?? []).map((layer) => [layer, '*']));
    writeFileSync(join(at, 'package.json'), JSON.stringify({ name, type: 'module', dependencies }));
    writeFileSync(join(at, 'ohne.config.ts'), config);
  }

  function writeBlock(dir: string, relative: string, fieldName = 'title'): void {
    const file = join(dir, relative);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(
      file,
      `export default { fields: { ${fieldName}: { type: 'text', options: {} } } };\n`,
    );
  }

  async function appWith(name: string, write: (app: string, dep: string) => void): Promise<string> {
    const app = join(root, name);
    writePackage(app, name, "export default { layers: ['dep'] };\n", ['dep']);
    const dep = join(app, 'packages', 'dep');
    writePackage(dep, 'dep', 'export default {};\n');
    mkdirSync(join(app, 'node_modules'), { recursive: true });
    symlinkSync(dep, join(app, 'node_modules', 'dep'), 'dir');
    write(app, dep);
    await loadLayers(app);
    return app;
  }

  before(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'ohne-collect-blocks-')));
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  afterEach(() => {
    useLayers().clear();
  });

  it('imports each definition, a closer layer replacing a further one by name', async () => {
    await appWith('override', (app, dep) => {
      writeBlock(dep, 'blocks/Hero.ts', 'title');
      writeBlock(dep, 'blocks/Banner.ts');
      writeBlock(app, 'blocks/Hero.ts', 'slug');
    });
    const collected = await collectBlocks(stackedLayers());
    deepStrictEqual(
      collected.map((block) => block.name),
      ['Banner', 'Hero'],
    );
    deepStrictEqual(Object.keys(collected[1]?.block.fields ?? {}), ['slug']);
  });

  it('drops disabled names after the merge', async () => {
    await appWith('disabled', (app) => {
      writeBlock(app, 'blocks/Hero.ts');
      writeBlock(app, 'blocks/Banner.ts');
    });
    const collected = await collectBlocks(stackedLayers(), { disable: ['Hero'] });
    deepStrictEqual(
      collected.map((block) => block.name),
      ['Banner'],
    );
  });

  it('rejects case-insensitively colliding names across layers, naming both files', async () => {
    await appWith('colliding', (app, dep) => {
      writeBlock(dep, 'blocks/Hero.ts');
      writeBlock(app, 'blocks/HERO.ts');
    });
    await rejects(collectBlocks(stackedLayers()), /`Hero` and `HERO` collide/);
  });

  it('rejects a file without a definition default export', async () => {
    await appWith('empty', (app) => {
      const file = join(app, 'blocks', 'Hero.ts');
      mkdirSync(join(file, '..'), { recursive: true });
      writeFileSync(file, 'export const hero = 1;\n');
    });
    await rejects(collectBlocks(stackedLayers()), /`Hero` has no definition/);
  });

  it('re-imports an edited definition only when fresh is set', async () => {
    const app = await appWith('fresh', (dir) => {
      writeBlock(dir, 'blocks/Hero.ts', 'title');
    });
    await collectBlocks(stackedLayers());
    writeBlock(app, 'blocks/Hero.ts', 'slug');
    const cached = await collectBlocks(stackedLayers());
    deepStrictEqual(Object.keys(cached[0]?.block.fields ?? {}), ['title']);
    const fresh = await collectBlocks(stackedLayers(), { fresh: true });
    deepStrictEqual(Object.keys(fresh[0]?.block.fields ?? {}), ['slug']);
  });
});

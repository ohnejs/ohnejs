import { deepStrictEqual, rejects } from 'node:assert';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';

import { collectCollections, loadLayers, useLayers } from '../../../src/ohne/index.ts';
import { stackedLayers } from '../../../src/ohne/layers/stacked-layers.ts';

describe('collectCollections', () => {
  let root: string;

  function writePackage(at: string, name: string, config: string, layers?: string[]): void {
    mkdirSync(at, { recursive: true });
    const dependencies = Object.fromEntries((layers ?? []).map((layer) => [layer, '*']));
    writeFileSync(join(at, 'package.json'), JSON.stringify({ name, type: 'module', dependencies }));
    writeFileSync(join(at, 'ohne.config.ts'), config);
  }

  function writeCollection(dir: string, relative: string, fieldName = 'title'): void {
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
    root = realpathSync(mkdtempSync(join(tmpdir(), 'ohne-collect-collections-')));
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  afterEach(() => {
    useLayers().clear();
  });

  it('imports each definition, a closer layer replacing a further one by name', async () => {
    await appWith('override', (app, dep) => {
      writeCollection(dep, 'collections/Posts.ts', 'title');
      writeCollection(dep, 'collections/Authors.ts');
      writeCollection(app, 'collections/Posts.ts', 'slug');
    });
    const collected = await collectCollections(stackedLayers());
    deepStrictEqual(
      collected.map((collection) => collection.name),
      ['Authors', 'Posts'],
    );
    deepStrictEqual(Object.keys(collected[1]?.collection.fields ?? {}), ['slug']);
  });

  it('drops disabled names after the merge', async () => {
    await appWith('disabled', (app) => {
      writeCollection(app, 'collections/Posts.ts');
      writeCollection(app, 'collections/Authors.ts');
    });
    const collected = await collectCollections(stackedLayers(), { disable: ['Posts'] });
    deepStrictEqual(
      collected.map((collection) => collection.name),
      ['Authors'],
    );
  });

  it('rejects case-insensitively colliding names across layers, naming both files', async () => {
    await appWith('colliding', (app, dep) => {
      writeCollection(dep, 'collections/Posts.ts');
      writeCollection(app, 'collections/POSTS.ts');
    });
    await rejects(collectCollections(stackedLayers()), /`Posts` and `POSTS` collide/);
  });

  it('rejects a file without a definition default export', async () => {
    await appWith('empty', (app) => {
      const file = join(app, 'collections', 'Posts.ts');
      mkdirSync(join(file, '..'), { recursive: true });
      writeFileSync(file, 'export const posts = 1;\n');
    });
    await rejects(collectCollections(stackedLayers()), /`Posts` has no definition/);
  });
});

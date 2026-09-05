import { deepStrictEqual, strictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { readLayerConfig } from '../../../src/ohne/index.ts';

describe('readLayerConfig', () => {
  let root: string;

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'ohne-read-layer-config-'));

    const layer = join(root, 'layer');
    mkdirSync(layer, { recursive: true });
    writeFileSync(join(layer, 'ohne.config.ts'), "export default { layers: ['base'] }\n");

    const owner = join(root, 'owner');
    mkdirSync(owner, { recursive: true });
    writeFileSync(join(owner, 'ohne.config.ts'), "export default { dirs: { api: 'routes' } }\n");
    writeFileSync(
      join(owner, 'ohne.layer.ts'),
      "export default { defaults: { disable: { routes: ['/x'] } }, strategies: { 'disable.routes': 'concat-unique' } }\n",
    );

    const generator = join(root, 'generator');
    mkdirSync(generator, { recursive: true });
    writeFileSync(join(generator, 'ohne.config.ts'), 'export default {}\n');
    writeFileSync(
      join(generator, 'ohne.layer.ts'),
      "export default { codegen: [{ bucket: 'node', file: 'x.ts', code: () => '' }] }\n",
    );

    mkdirSync(join(root, 'plain'), { recursive: true });
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns the input with empty defaults, strategies, and codegen when there is no ohne.layer.ts', async () => {
    deepStrictEqual(await readLayerConfig(join(root, 'layer')), {
      input: { layers: ['base'] },
      defaults: {},
      strategies: {},
      codegen: [],
    });
  });

  it('reads defaults and strategies from ohne.layer.ts', async () => {
    deepStrictEqual(await readLayerConfig(join(root, 'owner')), {
      input: { dirs: { api: 'routes' } },
      defaults: { disable: { routes: ['/x'] } },
      strategies: { 'disable.routes': 'concat-unique' },
      codegen: [],
    });
  });

  it('reads codegen entries from ohne.layer.ts', async () => {
    const config = await readLayerConfig(join(root, 'generator'));
    deepStrictEqual(
      config?.codegen.map(({ bucket, file }) => ({ bucket, file })),
      [{ bucket: 'node', file: 'x.ts' }],
    );
  });

  it('returns null when the directory has no ohne.config.ts', async () => {
    strictEqual(await readLayerConfig(join(root, 'plain')), null);
  });

  it('re-reads an edited config when fresh, past the module cache', async () => {
    const dir = join(root, 'fresh');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'ohne.config.ts');

    writeFileSync(file, "export default { dirs: { api: 'one' } }\n");
    deepStrictEqual((await readLayerConfig(dir))?.input, { dirs: { api: 'one' } });

    writeFileSync(file, "export default { dirs: { api: 'two' } }\n");
    deepStrictEqual((await readLayerConfig(dir))?.input, { dirs: { api: 'one' } });
    deepStrictEqual((await readLayerConfig(dir, { fresh: true }))?.input, { dirs: { api: 'two' } });
  });
});

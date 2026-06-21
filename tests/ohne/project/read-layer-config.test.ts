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

    mkdirSync(join(root, 'plain'), { recursive: true });
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns the input with empty defaults and strategies when there is no ohne.layer.ts', async () => {
    deepStrictEqual(await readLayerConfig(join(root, 'layer')), {
      input: { layers: ['base'] },
      defaults: {},
      strategies: {},
    });
  });

  it('reads defaults and strategies from ohne.layer.ts', async () => {
    deepStrictEqual(await readLayerConfig(join(root, 'owner')), {
      input: { dirs: { api: 'routes' } },
      defaults: { disable: { routes: ['/x'] } },
      strategies: { 'disable.routes': 'concat-unique' },
    });
  });

  it('returns null when the directory has no ohne.config.ts', async () => {
    strictEqual(await readLayerConfig(join(root, 'plain')), null);
  });
});

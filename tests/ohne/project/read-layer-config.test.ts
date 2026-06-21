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

    mkdirSync(join(root, 'plain'), { recursive: true });
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns the default export of the layer config', async () => {
    deepStrictEqual(await readLayerConfig(join(root, 'layer')), { layers: ['base'] });
  });

  it('returns null when the directory has no ohne.config.ts', async () => {
    strictEqual(await readLayerConfig(join(root, 'plain')), null);
  });
});

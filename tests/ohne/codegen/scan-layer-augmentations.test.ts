import { deepStrictEqual, strictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { scanLayerAugmentations } from '../../../src/ohne/index.ts';

describe('scanLayerAugmentations', () => {
  let root: string;

  function write(rel: string, content: string): string {
    const path = join(root, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    return path;
  }

  before(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'ohne-scan-aug-')));
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns the .ts files whose text augments the ohne module', async () => {
    const hooks = write('hooks.ts', "declare module 'ohne' { interface Hooks {} }\n");
    const env = write('config/env.ts', "declare module 'ohne' { interface Env {} }\n");
    write('routes/list.ts', "export default () => 'ok'\n");
    write('README.md', "declare module 'ohne'\n");
    write('node_modules/dep/aug.ts', "declare module 'ohne' {}\n");
    write('.ohne/node/layer-name.ts', "declare module 'ohne' {}\n");

    const files = await scanLayerAugmentations(root);
    deepStrictEqual(files, [env, hooks]);
  });

  it('returns [] for a directory that does not exist', async () => {
    strictEqual((await scanLayerAugmentations(join(root, 'nowhere'))).length, 0);
  });
});

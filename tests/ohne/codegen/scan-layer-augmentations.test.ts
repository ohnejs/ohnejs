import { deepStrictEqual, rejects, strictEqual } from 'node:assert';
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
    const hooks = write('hooks.ts', "declare module 'ohnejs' { interface Hooks {} }\n");
    const env = write('config/env.ts', "declare module 'ohnejs' { interface Env {} }\n");
    write('routes/list.ts', "export default () => 'ok'\n");
    write('README.md', "declare module 'ohnejs'\n");
    write('node_modules/dep/aug.ts', "declare module 'ohnejs' {}\n");
    write('.ohne/node/layer-name.ts', "declare module 'ohnejs' {}\n");

    const files = await scanLayerAugmentations(root);
    deepStrictEqual(files, [env, hooks]);
  });

  it('returns [] for a directory that does not exist', async () => {
    strictEqual((await scanLayerAugmentations(join(root, 'nowhere'))).length, 0);
  });

  it('ignores an unimportable path when the file does not augment', async () => {
    write('plain/notes#draft.ts', 'export const x = 1\n');
    const hooks = write('plain/hooks.ts', "declare module 'ohnejs' {}\n");
    deepStrictEqual(await scanLayerAugmentations(join(root, 'plain')), [hooks]);
  });

  it('throws for an augmenting file whose path holds an unimportable character', async () => {
    write('bad/aug#weird.ts', "declare module 'ohnejs' {}\n");
    await rejects(scanLayerAugmentations(join(root, 'bad')), /Unsupported character `#`/);
  });
});

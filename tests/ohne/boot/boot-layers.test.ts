import { deepStrictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { bootLayers, useLayers } from '../../../src/ohne/index.ts';

const scope = globalThis as typeof globalThis & { __ohneBootOrder: string[] };

describe('bootLayers', () => {
  let root: string;
  let dep: string;
  let app: string;
  let bare: string;

  function write(relative: string, mark: string): void {
    const file = join(root, relative);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, `globalThis.__ohneBootOrder.push(${JSON.stringify(mark)})\n`);
  }

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'ohne-boot-layers-'));
    dep = join(root, 'dep');
    bare = join(root, 'bare');
    app = join(root, 'app');

    write('dep/boot/b.ts', 'dep:b');
    write('dep/boot/a.ts', 'dep:a');
    write('app/boot/index.ts', 'app:index');
    write('app/boot/z.ts', 'app:z');

    useLayers().add({ path: dep, input: {} });
    useLayers().add({ path: bare, input: {} });
    useLayers().add({ path: app, input: {} });
  });

  after(() => {
    useLayers().remove(dep);
    useLayers().remove(bare);
    useLayers().remove(app);
    rmSync(root, { recursive: true, force: true });
  });

  it('runs each layer furthest-first, files in order, index alone', async () => {
    scope.__ohneBootOrder = [];
    await bootLayers();
    deepStrictEqual(scope.__ohneBootOrder, ['dep:a', 'dep:b', 'app:index']);
  });
});

import { deepStrictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { scanLayerBoot } from '../../../src/ohne/index.ts';

describe('scanLayerBoot', () => {
  let root: string;

  function write(relative: string): void {
    const file = join(root, relative);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, 'export default null\n');
  }

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'ohne-scan-layer-boot-'));
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns top-level files sorted by name', async () => {
    write('plain/boot/10-second.ts');
    write('plain/boot/2-first.ts');
    write('plain/boot/nested/ignored.ts');
    const files = await scanLayerBoot(join(root, 'plain'), 'boot');
    deepStrictEqual(
      files.map((file) => basename(file)),
      ['2-first.ts', '10-second.ts'],
    );
  });

  it('returns only index.ts when one is present', async () => {
    write('indexed/boot/index.ts');
    write('indexed/boot/a.ts');
    write('indexed/boot/b.ts');
    const files = await scanLayerBoot(join(root, 'indexed'), 'boot');
    deepStrictEqual(
      files.map((file) => basename(file)),
      ['index.ts'],
    );
  });

  it('returns an empty list when the boot directory is missing', async () => {
    deepStrictEqual(await scanLayerBoot(join(root, 'bare'), 'boot'), []);
  });
});

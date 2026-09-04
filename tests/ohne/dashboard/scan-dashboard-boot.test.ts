import { deepStrictEqual, rejects } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { type OhneLayer, scanDashboardBoot } from '../../../src/ohne/index.ts';

describe('scanDashboardBoot', () => {
  let root: string;

  function writeBoot(layerDir: string, relative: string): void {
    const file = join(layerDir, 'dashboard', 'boot', relative);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, 'export default null\n');
  }

  function layer(name: string): OhneLayer {
    return { name, dir: join(root, name) };
  }

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'ohne-scan-dashboard-boot-'));
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('maps each top-level file to a module, sorted by name', async () => {
    const plain = layer('plain');
    writeBoot(plain.dir, '10-slots.ts');
    writeBoot(plain.dir, '2-fields.ts');
    writeBoot(plain.dir, 'nested/ignored.ts');
    deepStrictEqual(await scanDashboardBoot(plain, 'dashboard'), [
      {
        module: 'boot/2-fields.ts',
        file: join(plain.dir, 'dashboard/boot/2-fields.ts'),
        layer: 'plain',
      },
      {
        module: 'boot/10-slots.ts',
        file: join(plain.dir, 'dashboard/boot/10-slots.ts'),
        layer: 'plain',
      },
    ]);
  });

  it('skips underscore-prefixed helper files', async () => {
    const helpers = layer('helpers');
    writeBoot(helpers.dir, 'fields.ts');
    writeBoot(helpers.dir, '_shared.ts');
    deepStrictEqual(
      (await scanDashboardBoot(helpers, 'dashboard')).map((boot) => boot.module),
      ['boot/fields.ts'],
    );
  });

  it('returns only index.ts when one is present', async () => {
    const indexed = layer('indexed');
    writeBoot(indexed.dir, 'index.ts');
    writeBoot(indexed.dir, 'a.ts');
    writeBoot(indexed.dir, 'b.ts');
    deepStrictEqual(
      (await scanDashboardBoot(indexed, 'dashboard')).map((boot) => boot.module),
      ['boot/index.ts'],
    );
  });

  it('reads the boot directory from the given dashboard directory', async () => {
    const custom = layer('custom');
    const file = join(custom.dir, 'ui', 'boot', 'fields.ts');
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, 'export default null\n');
    deepStrictEqual(
      (await scanDashboardBoot(custom, 'ui')).map((boot) => boot.module),
      ['boot/fields.ts'],
    );
  });

  it('returns an empty list when a layer has no boot directory', async () => {
    deepStrictEqual(await scanDashboardBoot(layer('bare'), 'dashboard'), []);
  });

  it('throws when a filename holds a character its browser import cannot resolve', async () => {
    const bad = layer('bad');
    writeBoot(bad.dir, 'a#b.ts');
    await rejects(
      scanDashboardBoot(bad, 'dashboard'),
      /Unsupported character `#` in a boot file path/,
    );
  });
});

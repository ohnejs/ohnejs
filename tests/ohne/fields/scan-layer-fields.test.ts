import { deepStrictEqual, rejects } from 'node:assert';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { scanLayerFields } from '../../../src/ohne/index.ts';

describe('scanLayerFields', () => {
  let root: string;

  function writeFieldType(dir: string, relative: string): void {
    const file = join(dir, 'fields', relative);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, "export default { columnType: 'text' };\n");
  }

  before(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'ohne-scan-fields-')));
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('names each file by its stem, a subdirectory only organizing', async () => {
    const dir = join(root, 'ordered');
    writeFieldType(dir, 'slug.ts');
    writeFieldType(dir, 'money.ts');
    writeFieldType(dir, 'geo/latLng.ts');
    const scanned = await scanLayerFields({ name: 'app', dir }, 'fields');
    deepStrictEqual(
      scanned.map((fieldType) => fieldType.name),
      ['latLng', 'money', 'slug'],
    );
    deepStrictEqual(scanned[0]?.file, join(dir, 'fields', 'geo/latLng.ts'));
  });

  it('returns an empty list without a fields directory', async () => {
    deepStrictEqual(await scanLayerFields({ name: 'app', dir: join(root, 'none') }, 'fields'), []);
  });

  it('skips underscore-prefixed helper files and directories', async () => {
    const dir = join(root, 'helpers');
    writeFieldType(dir, 'slug.ts');
    writeFieldType(dir, '_geo.ts');
    writeFieldType(dir, '_lib/shared.ts');
    const scanned = await scanLayerFields({ name: 'app', dir }, 'fields');
    deepStrictEqual(
      scanned.map((fieldType) => fieldType.name),
      ['slug'],
    );
  });

  it('rejects two files sharing a stem, naming both', async () => {
    const dir = join(root, 'duplicate');
    writeFieldType(dir, 'geo/point.ts');
    writeFieldType(dir, 'map/point.ts');
    await rejects(scanLayerFields({ name: 'app', dir }, 'fields'), /Duplicate field type `point`/);
  });

  it('rejects a non-camelCase file name', async () => {
    const dir = join(root, 'casing');
    writeFieldType(dir, 'Slug.ts');
    await rejects(scanLayerFields({ name: 'app', dir }, 'fields'), /camelCase/);
  });

  it('rejects an unimportable field-type path', async () => {
    const dir = join(root, 'weird');
    writeFieldType(dir, 'we%ird.ts');
    await rejects(scanLayerFields({ name: 'app', dir }, 'fields'), /Unsupported character/);
  });
});

import { deepStrictEqual, rejects } from 'node:assert';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { scanLayerCollections } from '../../../src/ohne/index.ts';

describe('scanLayerCollections', () => {
  let root: string;

  function writeCollection(dir: string, relative: string): void {
    const file = join(dir, 'collections', relative);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, 'export default { fields: {} };\n');
  }

  before(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'ohne-scan-collections-')));
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('names each file by its stem, a subdirectory only organizing', async () => {
    const dir = join(root, 'ordered');
    writeCollection(dir, 'Posts.ts');
    writeCollection(dir, 'Authors.ts');
    writeCollection(dir, 'blog/Tags.ts');
    const scanned = await scanLayerCollections({ name: 'app', dir }, 'collections');
    deepStrictEqual(
      scanned.map((collection) => collection.name),
      ['Authors', 'Tags', 'Posts'],
    );
    deepStrictEqual(scanned[1]?.file, join(dir, 'collections', 'blog/Tags.ts'));
  });

  it('returns an empty list without a collections directory', async () => {
    deepStrictEqual(
      await scanLayerCollections({ name: 'app', dir: join(root, 'none') }, 'collections'),
      [],
    );
  });

  it('skips underscore-prefixed helper files and directories', async () => {
    const dir = join(root, 'helpers');
    writeCollection(dir, 'Posts.ts');
    writeCollection(dir, '_shared.ts');
    writeCollection(dir, '_lib/Fields.ts');
    const scanned = await scanLayerCollections({ name: 'app', dir }, 'collections');
    deepStrictEqual(
      scanned.map((collection) => collection.name),
      ['Posts'],
    );
  });

  it('rejects two files sharing a stem, naming both', async () => {
    const dir = join(root, 'duplicate');
    writeCollection(dir, 'blog/Posts.ts');
    writeCollection(dir, 'shop/Posts.ts');
    await rejects(
      scanLayerCollections({ name: 'app', dir }, 'collections'),
      /Duplicate collection `Posts`/,
    );
  });

  it('rejects a non-PascalCase file name', async () => {
    const dir = join(root, 'casing');
    writeCollection(dir, 'posts.ts');
    await rejects(scanLayerCollections({ name: 'app', dir }, 'collections'), /PascalCase/);
  });

  it('rejects a reserved name', async () => {
    const dir = join(root, 'reserved');
    writeCollection(dir, 'Block.ts');
    await rejects(scanLayerCollections({ name: 'app', dir }, 'collections'), /reserved/);
  });

  it('rejects an unimportable collection path', async () => {
    const dir = join(root, 'weird');
    writeCollection(dir, 'We%ird.ts');
    await rejects(
      scanLayerCollections({ name: 'app', dir }, 'collections'),
      /Unsupported character/,
    );
  });
});

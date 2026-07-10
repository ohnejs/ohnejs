import { deepStrictEqual, match, ok, rejects } from 'node:assert';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { isOhneError } from '../../../src/ohne/error/ohne-error.ts';
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

  it('names each file by its relative path, segments PascalCased and joined', async () => {
    const dir = join(root, 'ordered');
    writeCollection(dir, 'Posts.ts');
    writeCollection(dir, 'Authors.ts');
    writeCollection(dir, 'blog/Tags.ts');
    writeCollection(dir, 'draft ideas.ts');
    writeCollection(dir, 'shop/index.ts');
    const scanned = await scanLayerCollections({ name: 'app', dir }, 'collections');
    deepStrictEqual(
      scanned.map((collection) => collection.name),
      ['Authors', 'BlogTags', 'DraftIdeas', 'Posts', 'Shop'],
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

  it('rejects two files resolving to the same name, naming both', async () => {
    const dir = join(root, 'duplicate');
    writeCollection(dir, 'BlogPosts.ts');
    writeCollection(dir, 'blog/Posts.ts');
    await rejects(scanLayerCollections({ name: 'app', dir }, 'collections'), (error: unknown) => {
      ok(isOhneError(error));
      match(error.message, /Duplicate collection `BlogPosts`/);
      const body = Array.isArray(error.body) ? error.body.join('\n') : (error.body ?? '');
      match(body, /Two files in layer `app` resolve to the same name\./);
      match(body, /BlogPosts\.ts/);
      match(body, /blog\/Posts\.ts/);
      return true;
    });
  });

  it('rejects a file name that resolves to no PascalCase identifier', async () => {
    const dir = join(root, 'casing');
    writeCollection(dir, '404.ts');
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

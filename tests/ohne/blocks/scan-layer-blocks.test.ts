import { deepStrictEqual, match, ok, rejects } from 'node:assert';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { isOhneError } from '../../../src/ohne/error/ohne-error.ts';
import { scanLayerBlocks } from '../../../src/ohne/index.ts';

describe('scanLayerBlocks', () => {
  let root: string;

  function writeBlock(dir: string, relative: string): void {
    const file = join(dir, 'blocks', relative);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, 'export default { fields: {} };\n');
  }

  before(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'ohne-scan-blocks-')));
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('names each file by its relative path, segments PascalCased and joined', async () => {
    const dir = join(root, 'ordered');
    writeBlock(dir, 'Hero.ts');
    writeBlock(dir, 'Banner.ts');
    writeBlock(dir, 'marketing/Quote.ts');
    writeBlock(dir, 'call out.ts');
    writeBlock(dir, 'gallery/index.ts');
    const scanned = await scanLayerBlocks({ name: 'app', dir }, 'blocks');
    deepStrictEqual(
      scanned.map((block) => block.name),
      ['Banner', 'CallOut', 'Gallery', 'Hero', 'MarketingQuote'],
    );
    deepStrictEqual(scanned[4]?.file, join(dir, 'blocks', 'marketing/Quote.ts'));
  });

  it('returns an empty list without a blocks directory', async () => {
    deepStrictEqual(await scanLayerBlocks({ name: 'app', dir: join(root, 'none') }, 'blocks'), []);
  });

  it('skips underscore-prefixed helper files and directories', async () => {
    const dir = join(root, 'helpers');
    writeBlock(dir, 'Hero.ts');
    writeBlock(dir, '_shared.ts');
    writeBlock(dir, '_lib/Fields.ts');
    const scanned = await scanLayerBlocks({ name: 'app', dir }, 'blocks');
    deepStrictEqual(
      scanned.map((block) => block.name),
      ['Hero'],
    );
  });

  it('rejects two files resolving to the same name, naming both', async () => {
    const dir = join(root, 'duplicate');
    writeBlock(dir, 'MarketingHero.ts');
    writeBlock(dir, 'marketing/Hero.ts');
    await rejects(scanLayerBlocks({ name: 'app', dir }, 'blocks'), (error: unknown) => {
      ok(isOhneError(error));
      match(error.message, /Duplicate block `MarketingHero`/);
      const body = Array.isArray(error.body) ? error.body.join('\n') : (error.body ?? '');
      match(body, /Two files in layer `app` resolve to the same name\./);
      match(body, /MarketingHero\.ts/);
      match(body, /marketing\/Hero\.ts/);
      return true;
    });
  });

  it('rejects a file name that resolves to no PascalCase identifier', async () => {
    const dir = join(root, 'casing');
    writeBlock(dir, '404.ts');
    await rejects(scanLayerBlocks({ name: 'app', dir }, 'blocks'), /PascalCase/);
  });

  it('rejects an unimportable block path', async () => {
    const dir = join(root, 'weird');
    writeBlock(dir, 'We%ird.ts');
    await rejects(scanLayerBlocks({ name: 'app', dir }, 'blocks'), /Unsupported character/);
  });
});

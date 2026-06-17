import { strictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { findUp } from '../../../src/utils/fs/index.ts';
import { normalizePath } from '../../../src/utils/index.ts';

describe('findUp', () => {
  let dir: string;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'ohne-find-up-'));
    mkdirSync(join(dir, 'a', 'b', 'c'), { recursive: true });
    writeFileSync(join(dir, 'marker.txt'), '');
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('finds an entry by walking up to the root', async () => {
    const found = await findUp('marker.txt', join(dir, 'a', 'b', 'c'));
    strictEqual(found?.endsWith('/marker.txt'), true);
  });

  it('returns the entry at the start directory itself', async () => {
    const found = await findUp('marker.txt', dir);
    strictEqual(found?.endsWith('/marker.txt'), true);
  });

  it('returns the absolute, normalized path to the match', async () => {
    const found = await findUp('marker.txt', join(dir, 'a'));
    strictEqual(found, normalizePath(join(dir, 'marker.txt')));
  });

  it('returns null when nothing matches up to the root', async () => {
    strictEqual(await findUp('nope.txt', join(dir, 'a', 'b')), null);
  });
});

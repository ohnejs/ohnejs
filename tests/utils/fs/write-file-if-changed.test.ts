import { strictEqual } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { writeFileIfChanged } from '../../../src/utils/fs/index.ts';

describe('writeFileIfChanged', () => {
  let dir: string;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'ohne-write-if-changed-'));
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes a missing file and reports the change', async () => {
    const f = join(dir, 'a.txt');
    strictEqual(await writeFileIfChanged(f, 'hello'), true);
    strictEqual(readFileSync(f, 'utf8'), 'hello');
  });

  it('rewrites changed content', async () => {
    const f = join(dir, 'b.txt');
    await writeFileIfChanged(f, 'first');
    strictEqual(await writeFileIfChanged(f, 'second'), true);
    strictEqual(readFileSync(f, 'utf8'), 'second');
  });

  it('skips the write when content is identical', async () => {
    const f = join(dir, 'c.txt');
    await writeFileIfChanged(f, 'same');
    const before = statSync(f).mtimeMs;
    strictEqual(await writeFileIfChanged(f, 'same'), false);
    strictEqual(statSync(f).mtimeMs, before);
  });

  it('detects a difference against an existing file', async () => {
    const f = join(dir, 'd.txt');
    writeFileSync(f, 'on disk');
    strictEqual(await writeFileIfChanged(f, 'on disk'), false);
    strictEqual(await writeFileIfChanged(f, 'updated'), true);
  });
});

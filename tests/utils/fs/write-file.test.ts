import { strictEqual } from 'node:assert';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { writeFile } from '../../../src/utils/fs/index.ts';

describe('writeFile', () => {
  let dir: string;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'ohne-write-file-'));
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes a file', async () => {
    const f = join(dir, 'a.txt');
    await writeFile(f, 'hello');
    strictEqual(readFileSync(f, 'utf8'), 'hello');
  });

  it('overwrites an existing file atomically', async () => {
    const f = join(dir, 'b.txt');
    await writeFile(f, 'first');
    await writeFile(f, 'second');
    strictEqual(readFileSync(f, 'utf8'), 'second');
  });

  it('creates missing parent directories', async () => {
    const f = join(dir, 'a', 'b', 'c.txt');
    await writeFile(f, 'nested');
    strictEqual(readFileSync(f, 'utf8'), 'nested');
  });

  it('leaves no temp file behind on success', async () => {
    const target = join(dir, 'clean');
    await writeFile(target, 'x');
    const stragglers = readdirSync(dir).filter(
      (name) => name.startsWith('clean.') && name.endsWith('.tmp'),
    );
    strictEqual(stragglers.length, 0);
  });

  it('survives concurrent writes (last one wins, no half-written file)', async () => {
    const f = join(dir, 'concurrent');
    await Promise.all([
      writeFile(f, 'a'.repeat(1000)),
      writeFile(f, 'b'.repeat(1000)),
      writeFile(f, 'c'.repeat(1000)),
    ]);
    const content = readFileSync(f, 'utf8');
    strictEqual(content.length, 1000);
    strictEqual(new Set(content).size, 1);
    strictEqual(statSync(f).isFile(), true);
  });
});

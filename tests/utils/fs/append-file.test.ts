import { strictEqual } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { appendFile } from '../../../src/utils/fs/index.ts';

describe('appendFile', () => {
  let dir: string;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'ohne-append-file-'));
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates the file when missing', async () => {
    const f = join(dir, 'log.txt');
    await appendFile(f, 'hello\n');
    strictEqual(readFileSync(f, 'utf8'), 'hello\n');
  });

  it('appends to an existing file', async () => {
    const f = join(dir, 'multi.txt');
    await appendFile(f, 'a\n');
    await appendFile(f, 'b\n');
    strictEqual(readFileSync(f, 'utf8'), 'a\nb\n');
  });

  it('creates missing parent directories', async () => {
    const f = join(dir, 'a', 'b', 'log.txt');
    await appendFile(f, 'nested\n');
    strictEqual(readFileSync(f, 'utf8'), 'nested\n');
  });

  it('keeps concurrent sub-PIPE_BUF writes atomic (no interleaved lines)', async () => {
    const f = join(dir, 'concurrent.log');
    const writers = Array.from({ length: 16 }, (_, i) => `writer-${i}\n`);
    await Promise.all(writers.map((line) => appendFile(f, line)));
    const lines = readFileSync(f, 'utf8')
      .split('\n')
      .filter((line) => line.length > 0);
    strictEqual(lines.length, writers.length);
    strictEqual(new Set(lines).size, writers.length);
    for (const line of lines) {
      strictEqual(writers.includes(`${line}\n`), true);
    }
  });
});

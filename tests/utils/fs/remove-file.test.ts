import { rejects, strictEqual } from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { removeFile } from '../../../src/utils/fs/index.ts';

describe('removeFile', () => {
  let dir: string;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'ohne-remove-file-'));
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('removes an existing file', async () => {
    const f = join(dir, 'a.txt');
    writeFileSync(f, 'x');
    await removeFile(f);
    strictEqual(existsSync(f), false);
  });

  it('is silent when the file is already gone', async () => {
    await removeFile(join(dir, 'missing.txt'));
  });

  it('throws when the path is a directory', async () => {
    const d = join(dir, 'sub');
    mkdirSync(d);
    await rejects(removeFile(d), /EISDIR|EPERM|EACCES/);
  });
});

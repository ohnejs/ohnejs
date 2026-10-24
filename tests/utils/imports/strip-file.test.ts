import { rejects, strictEqual } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { stripFile } from '../../../src/utils/imports/index.ts';

describe('stripFile', () => {
  let dir: string;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'ohne-strip-file-'));
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('strips the types, keeping every position', async () => {
    const source = 'export const add = (a: number, b: number) => a + b;\n';
    writeFileSync(join(dir, 'add.ts'), source);
    const stripped = await stripFile(join(dir, 'add.ts'));
    strictEqual(stripped, 'export const add = (a        , b        ) => a + b;\n');
    strictEqual(stripped?.length, source.length);
  });

  it('resolves null for a missing file', async () => {
    strictEqual(await stripFile(join(dir, 'missing.ts')), null);
  });

  it('throws on syntax the stripper cannot erase', async () => {
    writeFileSync(join(dir, 'enum.ts'), 'enum School { Frost }\n');
    await rejects(stripFile(join(dir, 'enum.ts')), { code: 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX' });
  });
});

import { strictEqual } from 'node:assert';
import { mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { importDefault } from '../../../src/utils/fs/index.ts';

describe('importDefault', () => {
  let root: string;

  before(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'ohne-import-default-')));
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns the default export', async () => {
    const file = join(root, 'value.ts');
    writeFileSync(file, 'export default 41;\n');
    strictEqual(await importDefault(file), 41);
  });

  it('returns null without a default export', async () => {
    const file = join(root, 'named.ts');
    writeFileSync(file, 'export const x = 1;\n');
    strictEqual(await importDefault(file), null);
  });

  it('re-imports past the module cache with fresh', async () => {
    const file = join(root, 'edited.ts');
    writeFileSync(file, 'export default 1;\n');
    strictEqual(await importDefault(file), 1);

    writeFileSync(file, 'export default 2;\n');
    utimesSync(file, new Date(), new Date(Date.now() + 1000));
    strictEqual(await importDefault(file), 1);
    strictEqual(await importDefault(file, { fresh: true }), 2);
  });
});

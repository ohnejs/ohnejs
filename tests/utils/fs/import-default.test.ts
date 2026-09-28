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

  it('re-imports an edited `_` helper with fresh, through the file that imports it', async () => {
    const helper = join(root, '_part.ts');
    const file = join(root, 'whole.ts');
    writeFileSync(helper, 'export default 1;\n');
    writeFileSync(file, "import part from './_part.ts';\nexport default part;\n");
    strictEqual(await importDefault(file, { fresh: true }), 1);

    writeFileSync(helper, 'export default 2;\n');
    utimesSync(helper, new Date(), new Date(Date.now() + 2000));
    strictEqual(await importDefault(file, { fresh: true }), 2);
  });

  it('re-imports an edited file whose mtime stays below a newer helper elsewhere', async () => {
    const helper = join(root, '_newest.ts');
    const holder = join(root, 'holder.ts');
    const file = join(root, 'older.ts');
    writeFileSync(helper, 'export default 0;\n');
    writeFileSync(holder, "import newest from './_newest.ts';\nexport default newest;\n");
    utimesSync(helper, new Date(), new Date(Date.now() + 60_000));
    await importDefault(holder, { fresh: true });

    writeFileSync(file, 'export default 1;\n');
    utimesSync(file, new Date(), new Date(Date.now() + 10_000));
    strictEqual(await importDefault(file, { fresh: true }), 1);
    writeFileSync(file, 'export default 2;\n');
    utimesSync(file, new Date(), new Date(Date.now() + 20_000));
    strictEqual(await importDefault(file, { fresh: true }), 2);
  });

  it('keeps any other import shared under fresh', async () => {
    const shared = join(root, 'shared.ts');
    const file = join(root, 'uses-shared.ts');
    writeFileSync(shared, 'export default {};\n');
    writeFileSync(file, "import shared from './shared.ts';\nexport default shared;\n");
    const instance = await importDefault(shared);

    strictEqual(await importDefault(file, { fresh: true }), instance);
    utimesSync(file, new Date(), new Date(Date.now() + 3000));
    strictEqual(await importDefault(file, { fresh: true }), instance);
  });
});

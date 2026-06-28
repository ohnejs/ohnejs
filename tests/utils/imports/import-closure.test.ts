import { deepStrictEqual } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { importClosure } from '../../../src/utils/imports/index.ts';
import { normalizePath } from '../../../src/utils/index.ts';

describe('importClosure', () => {
  let dir: string;

  before(() => {
    dir = normalizePath(mkdtempSync(join(tmpdir(), 'ohne-import-closure-')));
    writeFileSync(join(dir, 'entry.ts'), "import { b } from './b.ts'\nimport 'node:fs'");
    writeFileSync(join(dir, 'b.ts'), "import { c } from './c.ts'");
    writeFileSync(join(dir, 'c.ts'), "import { a } from './entry.ts'");
    writeFileSync(join(dir, 'orphan.ts'), '');
  });

  after(() => rmSync(dir, { recursive: true, force: true }));

  it('returns the entry plus every reachable project file', async () => {
    const closure = await importClosure(join(dir, 'entry.ts'));
    deepStrictEqual([...closure].sort(), [`${dir}/b.ts`, `${dir}/c.ts`, `${dir}/entry.ts`].sort());
  });

  it('terminates on cycles', async () => {
    const closure = await importClosure(join(dir, 'c.ts'));
    deepStrictEqual([...closure].sort(), [`${dir}/b.ts`, `${dir}/c.ts`, `${dir}/entry.ts`].sort());
  });

  it('ignores bare specifiers and keeps an import-free entry', async () => {
    const closure = await importClosure(join(dir, 'orphan.ts'));
    deepStrictEqual([...closure], [`${dir}/orphan.ts`]);
  });
});

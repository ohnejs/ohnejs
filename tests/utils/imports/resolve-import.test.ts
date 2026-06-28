import { strictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { resolveImport } from '../../../src/utils/imports/index.ts';
import { normalizePath } from '../../../src/utils/index.ts';

describe('resolveImport', () => {
  let dir: string;

  before(() => {
    dir = normalizePath(mkdtempSync(join(tmpdir(), 'ohne-resolve-import-')));
    writeFileSync(join(dir, 'a.ts'), '');
    writeFileSync(join(dir, 'b.ts'), '');
    writeFileSync(join(dir, 'c.tsx'), '');
    writeFileSync(join(dir, 'data.json'), '{}');
    writeFileSync(join(dir, 'real.ts'), '');
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'sub', 'index.ts'), '');
  });

  after(() => rmSync(dir, { recursive: true, force: true }));

  const from = (): string => join(dir, 'a.ts');

  it('resolves a relative import with an explicit extension', async () => {
    strictEqual(await resolveImport(from(), './b.ts'), `${dir}/b.ts`);
  });

  it('resolves an extensionless relative import to a .ts file', async () => {
    strictEqual(await resolveImport(from(), './b'), `${dir}/b.ts`);
  });

  it('resolves a directory import to its index file', async () => {
    strictEqual(await resolveImport(from(), './sub'), `${dir}/sub/index.ts`);
  });

  it('maps a .js specifier to its .ts sibling', async () => {
    strictEqual(await resolveImport(from(), './real.js'), `${dir}/real.ts`);
  });

  it('resolves a .tsx file from an extensionless specifier', async () => {
    strictEqual(await resolveImport(from(), './c'), `${dir}/c.tsx`);
  });

  it('resolves a json file', async () => {
    strictEqual(await resolveImport(from(), './data.json'), `${dir}/data.json`);
  });

  it('returns null for a bare specifier', async () => {
    strictEqual(await resolveImport(from(), 'node:fs'), null);
  });

  it('returns null for a scoped package', async () => {
    strictEqual(await resolveImport(from(), '@scope/pkg'), null);
  });

  it('returns null when no candidate file exists', async () => {
    strictEqual(await resolveImport(from(), './missing'), null);
  });
});

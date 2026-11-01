import { strictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { resolvePackageImport } from '../../../src/utils/imports/index.ts';
import { normalizePath } from '../../../src/utils/index.ts';

describe('resolvePackageImport', () => {
  let dir: string;
  let from: string;

  function writePackage(name: string, manifest: object, files: string[]): string {
    const pkg = join(dir, 'packages', name);
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name, ...manifest }));
    for (const file of files) {
      mkdirSync(join(pkg, file, '..'), { recursive: true });
      writeFileSync(join(pkg, file), '');
    }
    mkdirSync(join(dir, 'app', 'node_modules', name, '..'), { recursive: true });
    symlinkSync(pkg, join(dir, 'app', 'node_modules', name), 'dir');
    return pkg;
  }

  before(() => {
    dir = normalizePath(realpathSync(mkdtempSync(join(tmpdir(), 'ohne-resolve-package-'))));
    mkdirSync(join(dir, 'app'), { recursive: true });
    from = join(dir, 'app', 'a.ts');
    writeFileSync(from, '');
  });

  after(() => rmSync(dir, { recursive: true, force: true }));

  it('resolves a package through its exports to the real file', async () => {
    const pkg = writePackage('@acme/types', { exports: { '.': './index.ts', './*': './*' } }, [
      'index.ts',
      'user.ts',
    ]);

    strictEqual(await resolvePackageImport(from, '@acme/types'), `${pkg}/index.ts`);
    strictEqual(await resolvePackageImport(from, '@acme/types/user.ts'), `${pkg}/user.ts`);
  });

  it("resolves the `import` condition, as Node's `import` does", async () => {
    const pkg = writePackage(
      'esm-only',
      { type: 'module', exports: { './*': { import: './src/*' } } },
      ['src/x.ts'],
    );

    strictEqual(await resolvePackageImport(from, 'esm-only/x.ts'), `${pkg}/src/x.ts`);
  });

  it('maps a package without exports by its files and `main`', async () => {
    const pkg = writePackage('plain', { main: './main.ts' }, ['main.ts', 'lib/x.ts']);

    strictEqual(await resolvePackageImport(from, 'plain'), `${pkg}/main.ts`);
    strictEqual(await resolvePackageImport(from, 'plain/lib/x.ts'), `${pkg}/lib/x.ts`);
  });

  it('resolves a self-reference from inside the package', async () => {
    const pkg = writePackage('self', { exports: { './*': './*' } }, ['a.ts', 'b.ts']);

    strictEqual(await resolvePackageImport(join(pkg, 'a.ts'), 'self/b.ts'), `${pkg}/b.ts`);
  });

  it('answers null for a builtin, a missing package, or a file it does not hold', async () => {
    writePackage('empty', { exports: { './*': './*' } }, []);

    strictEqual(await resolvePackageImport(from, 'node:fs'), null);
    strictEqual(await resolvePackageImport(from, 'fs'), null);
    strictEqual(await resolvePackageImport(from, 'missing'), null);
    strictEqual(await resolvePackageImport(from, 'empty/x.ts'), null);
  });
});

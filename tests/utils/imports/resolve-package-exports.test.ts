import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { resolvePackageExports } from '../../../src/utils/imports/index.ts';

describe('resolvePackageExports', () => {
  it('unwraps the sugar for the root subpath', () => {
    strictEqual(resolvePackageExports('./index.ts', '.'), './index.ts');
    strictEqual(resolvePackageExports({ import: './index.ts' }, '.'), './index.ts');
    strictEqual(resolvePackageExports(['./index.ts'], '.'), './index.ts');
  });

  it('matches an exact key before a pattern', () => {
    const exports = { './x.ts': './exact.ts', './*': './src/*' };
    strictEqual(resolvePackageExports(exports, './x.ts'), './exact.ts');
    strictEqual(resolvePackageExports(exports, './y.ts'), './src/y.ts');
  });

  it('prefers the pattern with the longer prefix, then the longer key', () => {
    const exports = { './*': './a/*', './lib/*': './b/*', './lib/*.ts': './c/*.ts' };
    strictEqual(resolvePackageExports(exports, './lib/x.ts'), './c/x.ts');
    strictEqual(resolvePackageExports(exports, './lib/x.js'), './b/x.js');
    strictEqual(resolvePackageExports(exports, './x.ts'), './a/x.ts');
  });

  it("takes the first condition that Node's `import` matches, in key order", () => {
    const exports = { './*': { types: './types/*', require: './cjs/*', import: './esm/*' } };
    strictEqual(resolvePackageExports(exports, './x.ts'), './esm/x.ts');
    strictEqual(resolvePackageExports({ './*': { require: './cjs/*' } }, './x.ts'), null);
  });

  it('falls back through an array and stops at a `null` target', () => {
    strictEqual(resolvePackageExports({ '.': ['bad', './good.ts'] }, '.'), './good.ts');
    strictEqual(
      resolvePackageExports({ './*': './*', './private/*': null }, './private/x.ts'),
      null,
    );
    strictEqual(resolvePackageExports({ '.': { import: null, default: './x.ts' } }, '.'), null);
  });

  it('refuses a target that leaves the package or a map that mixes kinds', () => {
    strictEqual(resolvePackageExports({ './*': './*' }, './../x.ts'), null);
    strictEqual(resolvePackageExports({ '.': '../x.ts' }, '.'), null);
    strictEqual(resolvePackageExports({ '.': './x.ts', import: './y.ts' }, '.'), null);
    strictEqual(resolvePackageExports({ './x.ts': './x.ts' }, './y.ts'), null);
  });
});

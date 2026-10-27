import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { createTypeImports } from '../../../src/utils/codegen/index.ts';

describe('createTypeImports', () => {
  it('resolves a relative path against the referencing file, into an outputDir-relative specifier', () => {
    const imports = createTypeImports('/app/.ohne');
    strictEqual(
      imports.reference({ fromDir: '/app/fields', path: './geo.ts', exportName: 'LatLng' }),
      'LatLng',
    );
    deepStrictEqual(imports.statements(), ["import type { LatLng } from '../fields/geo.ts';"]);
  });

  it('passes a package specifier through unchanged', () => {
    const imports = createTypeImports('/app/.ohne');
    imports.reference({ fromDir: '/app/fields', path: 'zod', exportName: 'infer' });
    deepStrictEqual(imports.statements(), ["import type { infer } from 'zod';"]);
  });

  it('deduplicates the same export from the same module into one import', () => {
    const imports = createTypeImports('/app/.ohne');
    const a = imports.reference({ fromDir: '/app/fields', path: './geo.ts', exportName: 'LatLng' });
    const b = imports.reference({
      fromDir: '/app/other',
      path: '../fields/geo.ts',
      exportName: 'LatLng',
    });
    strictEqual(a, 'LatLng');
    strictEqual(b, 'LatLng');
    deepStrictEqual(imports.statements(), ["import type { LatLng } from '../fields/geo.ts';"]);
  });

  it('aliases a colliding export name from a different module', () => {
    const imports = createTypeImports('/app/.ohne');
    const a = imports.reference({ fromDir: '/app/fields', path: './a.ts', exportName: 'Point' });
    const b = imports.reference({ fromDir: '/app/fields', path: './b.ts', exportName: 'Point' });
    strictEqual(a, 'Point');
    strictEqual(b, 'Point2');
    deepStrictEqual(imports.statements(), [
      "import type { Point } from '../fields/a.ts';",
      "import type { Point as Point2 } from '../fields/b.ts';",
    ]);
  });

  it('aliases an export named like a declaration of the generated file', () => {
    const imports = createTypeImports('/app/.ohne', ['Locale']);
    strictEqual(
      imports.reference({ fromDir: '/app/fields', path: 'i18n-kit', exportName: 'Locale' }),
      'Locale2',
    );
    deepStrictEqual(imports.statements(), ["import type { Locale as Locale2 } from 'i18n-kit';"]);
  });

  it('groups multiple exports from one module onto a single line', () => {
    const imports = createTypeImports('/app/.ohne');
    imports.reference({ fromDir: '/app/fields', path: './geo.ts', exportName: 'LatLng' });
    imports.reference({ fromDir: '/app/fields', path: './geo.ts', exportName: 'Bounds' });
    deepStrictEqual(imports.statements(), [
      "import type { Bounds, LatLng } from '../fields/geo.ts';",
    ]);
  });

  it('escapes a specifier that would break the emitted string literal', () => {
    const imports = createTypeImports('/app/.ohne');
    imports.reference({ fromDir: "/app/it's fields", path: './geo.ts', exportName: 'LatLng' });
    deepStrictEqual(imports.statements(), [
      "import type { LatLng } from '../it\\'s fields/geo.ts';",
    ]);
  });

  it('rewrites each resolved path through `mapPath` before re-expressing it', () => {
    const store = '/app/node_modules/.pnpm/geo@1.0.0/node_modules/geo';
    const link = (path: string): string => path.replace(store, '/app/node_modules/geo');
    const imports = createTypeImports('/app/.ohne', [], link);
    imports.reference({ fromDir: `${store}/fields`, path: './geo.ts', exportName: 'LatLng' });
    deepStrictEqual(imports.statements(), [
      "import type { LatLng } from '../node_modules/geo/fields/geo.ts';",
    ]);
  });

  it('is empty before anything is referenced', () => {
    deepStrictEqual(createTypeImports('/app/.ohne').statements(), []);
  });
});

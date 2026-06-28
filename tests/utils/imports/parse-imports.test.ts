import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { parseImports } from '../../../src/utils/imports/index.ts';

describe('parseImports', () => {
  it('captures static named, default, and namespace imports', () => {
    const source = `
      import a from './a.ts'
      import { b } from './b.ts'
      import * as c from './c.ts'
      import d, { e } from './d.ts'
    `;
    deepStrictEqual(parseImports(source).sort(), ['./a.ts', './b.ts', './c.ts', './d.ts']);
  });

  it('captures side-effect imports', () => {
    deepStrictEqual(parseImports("import './styles.css'"), ['./styles.css']);
  });

  it('captures type-only imports', () => {
    deepStrictEqual(parseImports("import type { T } from './types.ts'"), ['./types.ts']);
  });

  it('captures re-exports', () => {
    const source = `
      export { a } from './a.ts'
      export * from './b.ts'
      export * as c from './c.ts'
    `;
    deepStrictEqual(parseImports(source).sort(), ['./a.ts', './b.ts', './c.ts']);
  });

  it('captures dynamic imports with literal specifiers', () => {
    const source = 'const m = await import(\'./m.ts\'); import("./n.ts")';
    deepStrictEqual(parseImports(source).sort(), ['./m.ts', './n.ts']);
  });

  it('returns bare and scoped specifiers verbatim', () => {
    const source = "import { x } from 'node:fs'\nimport y from '@scope/pkg'";
    deepStrictEqual(parseImports(source).sort(), ['@scope/pkg', 'node:fs']);
  });

  it('handles multi-line import clauses', () => {
    const source = 'import {\n a,\n b,\n} from "./multi.ts"';
    deepStrictEqual(parseImports(source), ['./multi.ts']);
  });

  it('dedupes repeated specifiers', () => {
    const source = "import { a } from './x.ts'\nimport { b } from './x.ts'";
    deepStrictEqual(parseImports(source), ['./x.ts']);
  });

  it('returns an empty array when there are no imports', () => {
    deepStrictEqual(parseImports('const x = 1'), []);
  });
});

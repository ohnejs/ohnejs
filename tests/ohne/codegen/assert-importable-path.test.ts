import { doesNotThrow, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { assertImportablePath } from '../../../src/ohne/codegen/assert-importable-path.ts';

describe('assertImportablePath', () => {
  it('passes a path whose every character survives an import specifier', () => {
    doesNotThrow(() =>
      assertImportablePath('route', 'users/[id].get.ts', '/app/api/users/[id].get.ts'),
    );
  });

  it('throws on each character that reparses as URL syntax', () => {
    for (const char of ['%', '#', '?']) {
      throws(
        () => assertImportablePath('route', `a${char}b.ts`, `/app/api/a${char}b.ts`),
        new RegExp(`Unsupported character \\\`\\${char}\\\` in a route path`),
      );
    }
  });

  it('names the kind it was given', () => {
    throws(
      () => assertImportablePath('middleware', 'a#b.ts', '/app/middleware/a#b.ts'),
      /in a middleware path/,
    );
  });
});

import { deepStrictEqual, strictEqual } from 'node:assert';
import { afterEach, describe, it } from 'node:test';

import type { MigrationMeta } from '../../../../src/ohne/index.ts';

import { useMigrations } from '../../../../src/ohne/index.ts';

function meta(name: string): MigrationMeta {
  return { name, migration: { from: { table: 'Posts' }, to: null }, file: `/app/${name}.ts` };
}

describe('useMigrations', () => {
  afterEach(() => useMigrations().clear());

  it('keeps registration order as the execution order', () => {
    useMigrations().register('ohne/002-second', meta('ohne/002-second'));
    useMigrations().register('app/001-first', meta('app/001-first'));
    deepStrictEqual(useMigrations().keys(), ['ohne/002-second', 'app/001-first']);
  });

  it('overrides on re-registration under the same name', () => {
    useMigrations().register('app/001-first', meta('app/001-first'));
    const fresh = meta('app/001-first');
    useMigrations().register('app/001-first', fresh);
    strictEqual(useMigrations().get('app/001-first'), fresh);
    strictEqual(useMigrations().size, 1);
  });
});

import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { defineMigration } from '../../../../src/ohne/index.ts';

describe('defineMigration', () => {
  it('returns the migration unchanged', () => {
    const migration = defineMigration({
      from: { table: 'Posts', column: 'isDraft', type: 'text' },
      to: { table: 'Posts', column: 'draft', type: 'boolean' },
      transform: (value) => value === 'yes',
    });
    strictEqual(defineMigration(migration), migration);
  });
});

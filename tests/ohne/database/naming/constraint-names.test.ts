import { strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import {
  foreignKeyName,
  indexName,
  primaryKeyName,
  uniqueName,
} from '../../../../src/ohne/database/naming/constraint-names.ts';
import { truncateWithHash } from '../../../../src/utils/crypto/index.ts';

describe('primaryKeyName', () => {
  it('prefixes the table', () => {
    strictEqual(primaryKeyName('Posts'), 'PK__Posts');
  });
});

describe('uniqueName', () => {
  it('joins the table and columns', () => {
    strictEqual(uniqueName('Users', ['email']), 'UX__Users__email');
  });

  it('lists composite columns in defined order, internal underscores kept', () => {
    strictEqual(
      uniqueName('Posts_authors', ['_parentUUID', '_targetUUID']),
      'UX__Posts_authors___parentUUID__targetUUID',
    );
  });
});

describe('indexName', () => {
  it('joins the table and columns', () => {
    strictEqual(indexName('Posts', ['author']), 'IX__Posts__author');
    strictEqual(indexName('Posts', ['author', 'status']), 'IX__Posts__author_status');
  });
});

describe('foreignKeyName', () => {
  it('names the table and column', () => {
    strictEqual(foreignKeyName('Posts', 'author'), 'FK__Posts__author');
  });
});

describe('truncation', () => {
  it('caps a constraint over a long table at the physical boundary', () => {
    const table = 'A'.repeat(80);
    strictEqual(uniqueName(table, ['email']), truncateWithHash(`UX__${table}__email`));
    strictEqual(uniqueName(table, ['email']).length, 63);
  });

  it('rejects an already-truncated table name', () => {
    const truncated = truncateWithHash('A'.repeat(80));
    throws(() => primaryKeyName(truncated), /already-truncated/);
  });
});

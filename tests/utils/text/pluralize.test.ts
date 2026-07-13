import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { pluralize } from '../../../src/utils/index.ts';

describe('pluralize', () => {
  it('returns the singular form when the count is one', () => {
    strictEqual(pluralize(1, 'row'), 'row');
  });

  it('returns the plural form when the count is zero', () => {
    strictEqual(pluralize(0, 'row'), 'rows');
  });

  it('returns the plural form when the count is greater than one', () => {
    strictEqual(pluralize(3, 'row'), 'rows');
  });

  it('treats a count of negative one as singular', () => {
    strictEqual(pluralize(-1, 'row'), 'row');
  });

  it('defaults the plural to the singular with an `s`', () => {
    strictEqual(pluralize(2, 'value'), 'values');
  });

  it('uses an explicit plural for irregular nouns', () => {
    strictEqual(pluralize(1, 'entry', 'entries'), 'entry');
    strictEqual(pluralize(4, 'entry', 'entries'), 'entries');
  });
});

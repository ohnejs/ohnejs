import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { recordHref } from '../../../src/utils/route/record-href.ts';

const MEDIA = { segment: 'uploads', recordPath: '/media?details=[uuid]' };

describe('recordHref', () => {
  it('opens the record editor without a declared path', () => {
    strictEqual(recordHref({ segment: 'items' }, '42'), '/collections/items/42');
  });

  it('fills the declared path, query string included', () => {
    strictEqual(recordHref(MEDIA, '42'), '/media?details=42');
  });

  it('percent-encodes the `UUID`', () => {
    strictEqual(recordHref({ segment: 'items' }, 'a b'), '/collections/items/a%20b');
  });

  it('joins params onto the path, or onto the query the declared path carries', () => {
    strictEqual(
      recordHref({ segment: 'items' }, '42', { locale: 'de' }),
      '/collections/items/42?locale=de',
    );
    strictEqual(recordHref(MEDIA, '42', { locale: 'de' }), '/media?details=42&locale=de');
    strictEqual(recordHref(MEDIA, '42', { locale: undefined }), '/media?details=42');
  });
});

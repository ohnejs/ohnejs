import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isRecordLink } from '../../../src/utils/index.ts';
import { PAGE } from './fixtures.ts';

describe('isRecordLink', () => {
  it('accepts a record link', () => {
    strictEqual(isRecordLink({ collection: 'Pages', record: PAGE }), true);
    strictEqual(isRecordLink({ collection: 'Pages', record: PAGE, hash: '#a', href: '/a' }), true);
  });

  it('refuses a URL link', () => {
    strictEqual(isRecordLink({ url: '/a' }), false);
    strictEqual(isRecordLink({ url: '/a', collection: undefined }), false);
  });

  it('refuses a malformed record link', () => {
    strictEqual(isRecordLink({ collection: 'Pages', record: 'home' }), false);
    strictEqual(isRecordLink({ collection: 'Pages', record: PAGE, rel: 'x' }), false);
    strictEqual(isRecordLink(null), false);
  });
});

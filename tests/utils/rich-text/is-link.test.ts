import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isLink } from '../../../src/utils/index.ts';
import { PAGE } from './fixtures.ts';

describe('isLink', () => {
  it('accepts a URL link and a record link', () => {
    strictEqual(isLink({ url: 'https://x.y' }), true);
    strictEqual(isLink({ url: '/a', newTab: true }), true);
    strictEqual(isLink({ collection: 'Pages', record: PAGE }), true);
    strictEqual(
      isLink({ collection: 'Pages', record: PAGE, hash: 'a', newTab: false, href: '/a' }),
      true,
    );
  });

  it('judges structure only', () => {
    strictEqual(isLink({ url: ' javascript:alert(1) ', href: '/x' }), true);
    strictEqual(isLink({ url: '' }), true);
    strictEqual(isLink({ collection: 'Anything', record: PAGE, hash: '#a b' }), true);
  });

  it('reads a key holding `undefined` as absent', () => {
    strictEqual(isLink({ url: '/a', collection: undefined, newTab: undefined }), true);
  });

  it('refuses a value that is not an object', () => {
    for (const value of [undefined, null, '/a', ['/a'], 1]) strictEqual(isLink(value), false);
  });

  it('refuses a link with neither `collection` nor `url`', () => {
    strictEqual(isLink({}), false);
    strictEqual(isLink({ record: PAGE }), false);
  });

  it('refuses a missing or mistyped key', () => {
    strictEqual(isLink({ url: 1 }), false);
    strictEqual(isLink({ url: '/a', newTab: 'yes' }), false);
    strictEqual(isLink({ collection: 'Pages' }), false);
    strictEqual(isLink({ collection: 1, record: PAGE }), false);
    strictEqual(isLink({ collection: 'Pages', record: 'home' }), false);
    strictEqual(isLink({ collection: 'Pages', record: PAGE, hash: 1 }), false);
  });

  it('refuses an unknown key', () => {
    strictEqual(isLink({ url: '/a', rel: 'nofollow' }), false);
    strictEqual(isLink({ url: '/a', record: PAGE }), false);
    strictEqual(isLink({ collection: 'Pages', record: PAGE, url: '/a' }), false);
  });
});

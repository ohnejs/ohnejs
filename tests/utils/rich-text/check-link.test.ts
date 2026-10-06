import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { checkLink } from '../../../src/utils/index.ts';
import { PAGE } from './fixtures.ts';

describe('checkLink', () => {
  it('passes a URL link by default', () => {
    deepStrictEqual(checkLink({ url: 'https://x.y', newTab: true }), []);
  });

  it('passes a record link into an allowed collection', () => {
    deepStrictEqual(
      checkLink({ collection: 'Pages', record: PAGE, hash: 'top', newTab: false }, ['Pages']),
      [],
    );
  });

  it('accepts `href` on either kind', () => {
    deepStrictEqual(checkLink({ url: '/a', href: '/b' }), []);
    deepStrictEqual(
      checkLink({ collection: 'Pages', record: PAGE, href: '/about' }, ['Pages']),
      [],
    );
  });

  it('refuses any link under `links: false`', () => {
    deepStrictEqual(checkLink({ url: 'https://x.y' }, false), [
      { path: '', key: 'validation.linksNotAllowed' },
    ]);
    deepStrictEqual(checkLink('x', false), [{ path: '', key: 'validation.linksNotAllowed' }]);
  });

  it('refuses a value that is not an object', () => {
    for (const value of [null, 'https://x.y', ['/a'], 1]) {
      deepStrictEqual(checkLink(value), [{ path: '', key: 'validation.invalidValue' }]);
    }
  });

  it('refuses a link with neither `collection` nor `url`', () => {
    deepStrictEqual(checkLink({ record: PAGE }), [{ path: '', key: 'validation.invalidValue' }]);
    deepStrictEqual(checkLink({ url: undefined }), [{ path: '', key: 'validation.invalidValue' }]);
  });

  it('refuses a record link under `links: true`', () => {
    deepStrictEqual(checkLink({ collection: 'Pages', record: PAGE }), [
      { path: 'collection', key: 'validation.invalidChoice' },
    ]);
  });

  it('refuses a record link into a collection that is not listed', () => {
    deepStrictEqual(checkLink({ collection: 'Users', record: PAGE }, ['Pages']), [
      { path: 'collection', key: 'validation.invalidChoice' },
    ]);
  });

  it('refuses a `collection` that is not a string', () => {
    deepStrictEqual(checkLink({ collection: 1, record: PAGE }, ['Pages']), [
      { path: 'collection', key: 'validation.invalidValue' },
    ]);
  });

  it('requires `record` on a record link', () => {
    deepStrictEqual(checkLink({ collection: 'Pages' }, ['Pages']), [
      { path: 'record', key: 'validation.required' },
    ]);
  });

  it('refuses a `record` that is not a `UUID`', () => {
    deepStrictEqual(checkLink({ collection: 'Pages', record: 'home' }, ['Pages']), [
      { path: 'record', key: 'validation.invalidValue' },
    ]);
  });

  it('refuses a `hash` holding whitespace, `#` or a control character', () => {
    for (const hash of ['a b', '#a', 'a\u0000', 'a ', 1]) {
      deepStrictEqual(checkLink({ collection: 'Pages', record: PAGE, hash }, ['Pages']), [
        { path: 'hash', key: 'validation.invalidValue' },
      ]);
    }
  });

  it('refuses a `url` that fails `isSafeHref`', () => {
    for (const url of [
      'javascript:alert(1)',
      ' https://x.y',
      'https://u:p@x.y',
      '//evil.com',
      '',
    ]) {
      deepStrictEqual(checkLink({ url }), [{ path: 'url', key: 'validation.invalidLink' }]);
    }
  });

  it('refuses a `url` that is not a string', () => {
    deepStrictEqual(checkLink({ url: 1 }), [{ path: 'url', key: 'validation.invalidValue' }]);
  });

  it('refuses a `newTab` that is not a boolean and an `href` that is not a string', () => {
    deepStrictEqual(checkLink({ url: '/a', newTab: 'yes', href: 1 }), [
      { path: 'newTab', key: 'validation.invalidValue' },
      { path: 'href', key: 'validation.invalidValue' },
    ]);
  });

  it('refuses an unknown key', () => {
    deepStrictEqual(checkLink({ url: '/a', rel: 'nofollow' }), [
      { path: 'rel', key: 'validation.unknownField' },
    ]);
    deepStrictEqual(checkLink({ url: '/a', record: PAGE }), [
      { path: 'record', key: 'validation.unknownField' },
    ]);
    deepStrictEqual(checkLink({ collection: 'Pages', record: PAGE, url: '/a' }, ['Pages']), [
      { path: 'url', key: 'validation.unknownField' },
    ]);
  });

  it('ignores a key holding `undefined`', () => {
    deepStrictEqual(checkLink({ url: '/a', collection: undefined, rel: undefined }), []);
  });

  it('lists every issue in key order, unknown keys last', () => {
    deepStrictEqual(
      checkLink({ extra: 1, href: 2, newTab: 3, hash: '#a', record: 'x', collection: 'Users' }, [
        'Pages',
      ]),
      [
        { path: 'collection', key: 'validation.invalidChoice' },
        { path: 'record', key: 'validation.invalidValue' },
        { path: 'hash', key: 'validation.invalidValue' },
        { path: 'newTab', key: 'validation.invalidValue' },
        { path: 'href', key: 'validation.invalidValue' },
        { path: 'extra', key: 'validation.unknownField' },
      ],
    );
  });
});

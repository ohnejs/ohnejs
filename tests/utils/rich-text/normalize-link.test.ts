import { deepStrictEqual, notStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { Link } from '../../../src/utils/index.ts';

import { normalizeLink } from '../../../src/utils/index.ts';
import { PAGE } from './fixtures.ts';

describe('normalizeLink', () => {
  it('drops `href` from a record link', () => {
    deepStrictEqual(normalizeLink({ collection: 'Pages', record: PAGE, href: '/about' }), {
      collection: 'Pages',
      record: PAGE,
    });
  });

  it('drops `href` from a URL link', () => {
    deepStrictEqual(normalizeLink({ url: '/a', href: '/b' } as Link), { url: '/a' });
  });

  it('drops `newTab: false` and keeps `newTab: true`', () => {
    deepStrictEqual(normalizeLink({ url: '/a', newTab: false }), { url: '/a' });
    deepStrictEqual(normalizeLink({ url: '/a', newTab: true }), { url: '/a', newTab: true });
    deepStrictEqual(normalizeLink({ collection: 'Pages', record: PAGE, newTab: true }), {
      collection: 'Pages',
      record: PAGE,
      newTab: true,
    });
  });

  it('strips leading `#`s from `hash`', () => {
    deepStrictEqual(normalizeLink({ collection: 'Pages', record: PAGE, hash: '#top' }), {
      collection: 'Pages',
      record: PAGE,
      hash: 'top',
    });
    deepStrictEqual(normalizeLink({ collection: 'Pages', record: PAGE, hash: '##top' }), {
      collection: 'Pages',
      record: PAGE,
      hash: 'top',
    });
  });

  it('drops an empty `hash`', () => {
    deepStrictEqual(normalizeLink({ collection: 'Pages', record: PAGE, hash: '' }), {
      collection: 'Pages',
      record: PAGE,
    });
    deepStrictEqual(normalizeLink({ collection: 'Pages', record: PAGE, hash: '#' }), {
      collection: 'Pages',
      record: PAGE,
    });
  });

  it('trims `url`', () => {
    deepStrictEqual(normalizeLink({ url: ' \thttps://x.y\n ' }), { url: 'https://x.y' });
  });

  it('orders the keys canonically', () => {
    const link = normalizeLink({ newTab: true, hash: 'a', record: PAGE, collection: 'Pages' });
    deepStrictEqual(Object.keys(link), ['collection', 'record', 'hash', 'newTab']);
  });

  it('reads a `collection` holding `undefined` as absent', () => {
    deepStrictEqual(normalizeLink({ url: '/a', collection: undefined } as Link), { url: '/a' });
  });

  it('returns a new link and never mutates its input', () => {
    const link: Link = { collection: 'Pages', record: PAGE, hash: '#a', newTab: false, href: '/x' };
    const before = structuredClone(link);
    notStrictEqual(normalizeLink(link), link);
    deepStrictEqual(link, before);
  });

  it('gives the same result when run twice', () => {
    for (const link of [
      { url: ' /a ', newTab: false },
      { collection: 'Pages', record: PAGE, hash: '##a', newTab: true, href: '/x' },
    ] satisfies Link[]) {
      deepStrictEqual(normalizeLink(normalizeLink(link)), normalizeLink(link));
    }
  });
});

import { strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { fillRoute } from '../../../src/utils/route/fill-route.ts';

describe('fillRoute', () => {
  it('fills bracketed and colon params', () => {
    strictEqual(
      fillRoute('/collections/[collection]/[uuid]', { collection: 'Items', uuid: '42' }),
      '/collections/Items/42',
    );
    strictEqual(fillRoute('/authors/:id/posts', { id: '7' }), '/authors/7/posts');
  });

  it('percent-encodes each value', () => {
    strictEqual(fillRoute('/authors/[name]', { name: 'a b?#%' }), '/authors/a%20b%3F%23%25');
  });

  it('keeps a catch-all value in segments, each encoded', () => {
    strictEqual(
      fillRoute('/files/[...path]', { path: 'maps/old map.png' }),
      '/files/maps/old%20map.png',
    );
  });

  it('ignores params the pattern does not name', () => {
    strictEqual(fillRoute('/authors/[id]', { id: '1', extra: 'x' }), '/authors/1');
  });

  it('throws on a missing param', () => {
    throws(() => fillRoute('/authors/[id]', {}), /Missing route param `id`/);
  });

  it('refuses a value that would change the path', () => {
    for (const id of ['a/b', '', '.', '..'])
      throws(() => fillRoute('/authors/[id]', { id }), /Invalid route param `id`/);
    for (const path of ['a//b', '../etc', 'a/./b', 'a/'])
      throws(() => fillRoute('/files/[...path]', { path }), /Invalid route param `path`/);
  });
});

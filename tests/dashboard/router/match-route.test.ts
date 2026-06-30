import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { compilePages, matchPages } from '../../../src/dashboard/router/match-route.ts';

const manifest = [
  { pattern: '/users/new', url: '/m/app/pages/users/new.ts' },
  { pattern: '/users/[id]', url: '/m/app/pages/users/[id].ts' },
  { pattern: '/[...all]', url: '/m/app/pages/[...all].ts' },
];

describe('matchPages', () => {
  const pages = compilePages(manifest);

  it('takes the first, most specific, match', () => {
    strictEqual(matchPages(pages, '/users/new')?.url, '/m/app/pages/users/new.ts');
  });

  it('matches a dynamic param and URI-decodes it', () => {
    const match = matchPages(pages, '/users/a%20b');
    strictEqual(match?.url, '/m/app/pages/users/[id].ts');
    deepStrictEqual(match?.params, { id: 'a b' });
  });

  it('falls through to the catch-all', () => {
    strictEqual(matchPages(pages, '/anything/deep')?.url, '/m/app/pages/[...all].ts');
  });

  it('carries the matched path', () => {
    strictEqual(matchPages(pages, '/users/42')?.path, '/users/42');
  });

  it('returns null when nothing matches', () => {
    const only = compilePages([{ pattern: '/users/[id]', url: 'x' }]);
    strictEqual(matchPages(only, '/posts/1'), null);
  });
});

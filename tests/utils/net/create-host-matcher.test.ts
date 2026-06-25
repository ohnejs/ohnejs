import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { createHostMatcher } from '../../../src/utils/index.ts';

describe('createHostMatcher', () => {
  it('matches an exact hostname', () => {
    const allowed = createHostMatcher(['example.com']);
    strictEqual(allowed('example.com'), true);
    strictEqual(allowed('evil.com'), false);
  });

  it('matches any subdomain with a wildcard, but not the apex', () => {
    const allowed = createHostMatcher(['*.example.com']);
    strictEqual(allowed('api.example.com'), true);
    strictEqual(allowed('a.b.example.com'), true);
    strictEqual(allowed('example.com'), false);
  });

  it('does not over-match a hostname missing the literal dot', () => {
    const allowed = createHostMatcher(['*.example.com']);
    strictEqual(allowed('xexample.com'), false);
  });

  it('is case-insensitive', () => {
    const allowed = createHostMatcher(['Example.COM']);
    strictEqual(allowed('example.com'), true);
    strictEqual(allowed('EXAMPLE.COM'), true);
  });

  it('matches nothing when the list is empty', () => {
    strictEqual(createHostMatcher([])('example.com'), false);
  });
});

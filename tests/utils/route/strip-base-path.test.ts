import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { stripBasePath } from '../../../src/utils/index.ts';

describe('stripBasePath', () => {
  it('removes the prefix from a path under the mount', () => {
    strictEqual(stripBasePath('/api/users', '/api'), '/users');
    strictEqual(stripBasePath('/api/users/42', '/api'), '/users/42');
  });

  it('maps the mount root itself to /', () => {
    strictEqual(stripBasePath('/api', '/api'), '/');
    strictEqual(stripBasePath('/api/', '/api'), '/');
  });

  it('returns the path unchanged when no prefix is mounted', () => {
    strictEqual(stripBasePath('/users', ''), '/users');
    strictEqual(stripBasePath('/', ''), '/');
  });

  it('returns null for a path outside the mount', () => {
    strictEqual(stripBasePath('/users', '/api'), null);
    strictEqual(stripBasePath('/', '/api'), null);
  });

  it('matches whole segments, not string prefixes', () => {
    strictEqual(stripBasePath('/apiece', '/api'), null);
    strictEqual(stripBasePath('/api-v2/users', '/api'), null);
  });

  it('strips a multi-segment base path', () => {
    strictEqual(stripBasePath('/api/v1/users', '/api/v1'), '/users');
    strictEqual(stripBasePath('/api/v1', '/api/v1'), '/');
  });
});

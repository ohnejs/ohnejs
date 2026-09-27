import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { trimRoutePath } from '../../../src/utils/index.ts';

describe('trimRoutePath', () => {
  it('drops one trailing slash', () => {
    strictEqual(trimRoutePath('/admin/users/'), '/admin/users');
    strictEqual(trimRoutePath('/admin//'), '/admin/');
  });

  it('keeps a path without one', () => {
    strictEqual(trimRoutePath('/admin'), '/admin');
    strictEqual(trimRoutePath('/'), '/');
  });
});

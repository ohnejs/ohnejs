import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { compileRoute } from '../../../src/utils/index.ts';

describe('compileRoute', () => {
  it('matches a static path', () => {
    const m = compileRoute('/users');
    deepStrictEqual(m('/users'), {});
    strictEqual(m('/posts'), null);
  });

  it('captures a bracketed param', () => {
    const m = compileRoute('/users/[id]');
    deepStrictEqual(m('/users/42'), { id: '42' });
    strictEqual(m('/users/'), null);
    strictEqual(m('/users/42/extra'), null);
  });

  it('captures a colon param', () => {
    const m = compileRoute('/users/:id');
    deepStrictEqual(m('/users/42'), { id: '42' });
  });

  it('mixes bracket and colon syntax', () => {
    const m = compileRoute('/users/[id]/posts/:slug');
    deepStrictEqual(m('/users/42/posts/hello'), { id: '42', slug: 'hello' });
  });

  it('captures a catch-all across multiple segments', () => {
    const m = compileRoute('/files/[...path]');
    deepStrictEqual(m('/files/a/b/c'), { path: 'a/b/c' });
    deepStrictEqual(m('/files/just-one'), { path: 'just-one' });
  });

  it('rejects an empty catch-all', () => {
    const m = compileRoute('/files/[...path]');
    strictEqual(m('/files/'), null);
    strictEqual(m('/files'), null);
  });

  it('normalizes leading and trailing slashes on the pattern', () => {
    strictEqual(compileRoute('users/[id]').pattern, '/users/[id]');
    strictEqual(compileRoute('/users/[id]/').pattern, '/users/[id]');
    strictEqual(compileRoute('').pattern, '/');
    strictEqual(compileRoute('/').pattern, '/');
  });

  it('tolerates a trailing slash on the matched path', () => {
    const m = compileRoute('/users/[id]');
    deepStrictEqual(m('/users/42/'), { id: '42' });
  });

  it('escapes regex metacharacters in static segments', () => {
    const m = compileRoute('/a.b/[id]');
    deepStrictEqual(m('/a.b/42'), { id: '42' });
    strictEqual(m('/axb/42'), null);
  });

  it('does not let a named param match across segments', () => {
    const m = compileRoute('/a/[x]');
    strictEqual(m('/a/x/y'), null);
  });

  it('matches the root pattern', () => {
    const m = compileRoute('/');
    deepStrictEqual(m('/'), {});
    strictEqual(m('/anything'), null);
  });

  it('exposes the param names in order', () => {
    deepStrictEqual(compileRoute('/users/[id]/posts/:slug').params, ['id', 'slug']);
    deepStrictEqual(compileRoute('/static').params, []);
  });

  it('returns raw (undecoded) param values', () => {
    const m = compileRoute('/users/[name]');
    deepStrictEqual(m('/users/john%20doe'), { name: 'john%20doe' });
  });

  it('exposes the compiled regex', () => {
    const m = compileRoute('/users/[id]');
    strictEqual(m.regex instanceof RegExp, true);
    strictEqual(m.regex.test('/users/42'), true);
  });
});

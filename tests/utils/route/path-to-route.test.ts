import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { pathToRoute } from '../../../src/utils/index.ts';

describe('pathToRoute', () => {
  it('extracts a method suffix', () => {
    deepStrictEqual(pathToRoute('./foo/[bar]/index.post.ts'), {
      method: 'POST',
      pattern: '/foo/[bar]',
    });
  });

  it('returns a null method when no suffix is present', () => {
    deepStrictEqual(pathToRoute('./foo/bar.ts'), {
      method: null,
      pattern: '/foo/bar',
    });
  });

  it('recognizes every standard method', () => {
    for (const m of ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const) {
      strictEqual(pathToRoute(`./foo.${m}.ts`).method, m.toUpperCase());
    }
  });

  it('extracts a method from a colon-param file, normalizing the param', () => {
    deepStrictEqual(pathToRoute('./users/:id.get.ts'), {
      method: 'GET',
      pattern: '/users/[id]',
    });
  });

  it('extracts a method when the basename is bracketed', () => {
    deepStrictEqual(pathToRoute('./[id].delete.ts'), {
      method: 'DELETE',
      pattern: '/[id]',
    });
  });

  it('handles an index file with a method suffix', () => {
    deepStrictEqual(pathToRoute('./index.post.ts'), {
      method: 'POST',
      pattern: '/',
    });
  });

  it('does not interpret arbitrary suffixes as methods', () => {
    deepStrictEqual(pathToRoute('./foo.config.ts'), {
      method: null,
      pattern: '/foo.config',
    });
  });

  it('uppercases an upper or mixed-case method suffix', () => {
    strictEqual(pathToRoute('./foo.POST.ts').method, 'POST');
    strictEqual(pathToRoute('./foo.Get.ts').method, 'GET');
  });

  it('preserves a catch-all when paired with a method', () => {
    deepStrictEqual(pathToRoute('./files/[...path].get.ts'), {
      method: 'GET',
      pattern: '/files/[...path]',
    });
  });
});

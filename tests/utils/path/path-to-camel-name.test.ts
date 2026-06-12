import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { pathToCamelName } from '../../../src/utils/index.ts';

describe('pathToCamelName', () => {
  it('joins kebab-cased segments into camelCase', () => {
    strictEqual(pathToCamelName('foo/bar-baz.ts'), 'fooBarBaz');
  });

  it('collapses a trailing `index` into its parent', () => {
    strictEqual(pathToCamelName('foo/index.ts'), 'foo');
    strictEqual(pathToCamelName('foo/bar/index.ts'), 'fooBar');
  });

  it('returns an empty string for an empty path', () => {
    strictEqual(pathToCamelName(''), '');
  });

  it('returns an empty string when the path is just `index.ts`', () => {
    strictEqual(pathToCamelName('index.ts'), '');
  });

  it('lowercases an all-caps leading segment entirely', () => {
    strictEqual(pathToCamelName('HTML/content.ts'), 'htmlContent');
    strictEqual(pathToCamelName('BAR.ts'), 'bar');
  });

  it('preserves all-caps acronyms in trailing segments', () => {
    strictEqual(pathToCamelName('content/HTML.ts'), 'contentHTML');
    strictEqual(pathToCamelName('foo/BAR.ts'), 'fooBAR');
  });

  it('only lowercases the first character of a mixed-case leading segment', () => {
    strictEqual(pathToCamelName('BlogPosts.ts'), 'blogPosts');
    strictEqual(pathToCamelName('MyField/inner.ts'), 'myFieldInner');
  });

  it('treats backslashes as separators', () => {
    strictEqual(pathToCamelName('src\\foo\\bar.ts'), 'srcFooBar');
  });

  it('normalizes a leading `./`', () => {
    strictEqual(pathToCamelName('./foo/bar.ts'), 'fooBar');
  });

  it('skips degenerate segments and promotes the next one to head', () => {
    strictEqual(pathToCamelName('---/HTML.ts'), 'html');
    strictEqual(pathToCamelName('foo/---/bar.ts'), 'fooBar');
  });
});

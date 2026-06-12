import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { pathToPascalName } from '../../../src/utils/index.ts';

describe('pathToPascalName', () => {
  it('joins kebab-cased segments into PascalCase', () => {
    strictEqual(pathToPascalName('foo/bar-baz.ts'), 'FooBarBaz');
  });

  it('collapses a trailing `index` into its parent', () => {
    strictEqual(pathToPascalName('foo/index.ts'), 'Foo');
    strictEqual(pathToPascalName('foo/bar/index.ts'), 'FooBar');
  });

  it('returns an empty string for an empty path', () => {
    strictEqual(pathToPascalName(''), '');
  });

  it('returns an empty string when the path is just `index.ts`', () => {
    strictEqual(pathToPascalName('index.ts'), '');
  });

  it('returns an empty string when every segment is non-alphanumeric', () => {
    strictEqual(pathToPascalName('---/---.ts'), '');
  });

  it('preserves all-caps acronym segments in any position', () => {
    strictEqual(pathToPascalName('HTML/parser.ts'), 'HTMLParser');
    strictEqual(pathToPascalName('parser/HTML.ts'), 'ParserHTML');
    strictEqual(pathToPascalName('blog/HTML/parser.ts'), 'BlogHTMLParser');
  });

  it('keeps mixed-case segments verbatim past the first character', () => {
    strictEqual(pathToPascalName('BlogPosts.ts'), 'BlogPosts');
    strictEqual(pathToPascalName('blogPosts.ts'), 'BlogPosts');
  });

  it('treats backslashes as separators', () => {
    strictEqual(pathToPascalName('src\\foo\\bar.ts'), 'SrcFooBar');
  });

  it('normalizes a leading `./`', () => {
    strictEqual(pathToPascalName('./foo/bar.ts'), 'FooBar');
  });

  it('skips degenerate segments', () => {
    strictEqual(pathToPascalName('foo/---/bar.ts'), 'FooBar');
  });
});

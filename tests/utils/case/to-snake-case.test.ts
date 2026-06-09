import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { toSnakeCase } from '../../../src/utils/index.ts';

describe('toSnakeCase', () => {
  it('converts PascalCase', () => {
    strictEqual(toSnakeCase('BlogPosts'), 'blog_posts');
  });

  it('converts camelCase', () => {
    strictEqual(toSnakeCase('featuredImage'), 'featured_image');
  });

  it('converts kebab-case', () => {
    strictEqual(toSnakeCase('blog-posts'), 'blog_posts');
  });

  it('lowercases an already-snake string', () => {
    strictEqual(toSnakeCase('blog_posts'), 'blog_posts');
  });

  it('handles acronyms', () => {
    strictEqual(toSnakeCase('HTMLParser'), 'html_parser');
    strictEqual(toSnakeCase('parseURL'), 'parse_url');
  });

  it('splits letter/digit boundaries', () => {
    strictEqual(toSnakeCase('user2FA'), 'user_2_fa');
  });

  it('handles single-character input', () => {
    strictEqual(toSnakeCase('x'), 'x');
  });

  it('returns an empty string for empty input', () => {
    strictEqual(toSnakeCase(''), '');
  });

  it('returns an empty string for separator-only input', () => {
    strictEqual(toSnakeCase('___'), '');
  });
});

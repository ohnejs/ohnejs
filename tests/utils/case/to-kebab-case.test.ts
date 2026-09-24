import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { toKebabCase } from '../../../src/utils/index.ts';

describe('toKebabCase', () => {
  it('converts PascalCase', () => {
    strictEqual(toKebabCase('BlogPosts'), 'blog-posts');
  });

  it('converts camelCase', () => {
    strictEqual(toKebabCase('featuredImage'), 'featured-image');
  });

  it('lowercases an already-kebab string', () => {
    strictEqual(toKebabCase('blog-posts'), 'blog-posts');
  });

  it('converts snake_case', () => {
    strictEqual(toKebabCase('blog_posts'), 'blog-posts');
  });

  it('handles acronyms', () => {
    strictEqual(toKebabCase('HTMLParser'), 'html-parser');
    strictEqual(toKebabCase('parseURL'), 'parse-url');
  });

  it('keeps digits in their word', () => {
    strictEqual(toKebabCase('user2FA'), 'user2-fa');
    strictEqual(toKebabCase('s3-sync'), 's3-sync');
  });

  it('handles single-character input', () => {
    strictEqual(toKebabCase('x'), 'x');
  });

  it('returns an empty string for empty input', () => {
    strictEqual(toKebabCase(''), '');
  });

  it('returns an empty string for separator-only input', () => {
    strictEqual(toKebabCase('---'), '');
  });
});

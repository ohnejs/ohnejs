import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isKebabCase } from '../../../src/utils/index.ts';

describe('isKebabCase', () => {
  it('accepts a canonical kebab string', () => {
    strictEqual(isKebabCase('blog-posts'), true);
  });

  it('accepts a single lowercase word', () => {
    strictEqual(isKebabCase('blog'), true);
  });

  it('accepts digits in segments', () => {
    strictEqual(isKebabCase('user-2fa'), true);
  });

  it('rejects camelCase', () => {
    strictEqual(isKebabCase('blogPosts'), false);
  });

  it('rejects PascalCase', () => {
    strictEqual(isKebabCase('BlogPosts'), false);
  });

  it('rejects snake_case', () => {
    strictEqual(isKebabCase('blog_posts'), false);
  });

  it('rejects double hyphens', () => {
    strictEqual(isKebabCase('blog--posts'), false);
  });

  it('rejects leading and trailing hyphens', () => {
    strictEqual(isKebabCase('-blog'), false);
    strictEqual(isKebabCase('blog-'), false);
  });

  it('rejects empty input', () => {
    strictEqual(isKebabCase(''), false);
  });

  it('rejects whitespace', () => {
    strictEqual(isKebabCase('blog posts'), false);
  });
});

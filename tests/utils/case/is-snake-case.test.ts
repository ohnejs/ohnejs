import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isSnakeCase } from '../../../src/utils/index.ts';

describe('isSnakeCase', () => {
  it('accepts a canonical snake string', () => {
    strictEqual(isSnakeCase('blog_posts'), true);
  });

  it('accepts a single lowercase word', () => {
    strictEqual(isSnakeCase('blog'), true);
  });

  it('accepts digits in segments', () => {
    strictEqual(isSnakeCase('user_2fa'), true);
  });

  it('rejects camelCase', () => {
    strictEqual(isSnakeCase('blogPosts'), false);
  });

  it('rejects PascalCase', () => {
    strictEqual(isSnakeCase('BlogPosts'), false);
  });

  it('rejects kebab-case', () => {
    strictEqual(isSnakeCase('blog-posts'), false);
  });

  it('rejects double underscores', () => {
    strictEqual(isSnakeCase('blog__posts'), false);
  });

  it('rejects leading and trailing underscores', () => {
    strictEqual(isSnakeCase('_blog'), false);
    strictEqual(isSnakeCase('blog_'), false);
  });

  it('rejects empty input', () => {
    strictEqual(isSnakeCase(''), false);
  });

  it('rejects whitespace', () => {
    strictEqual(isSnakeCase('blog posts'), false);
  });
});

import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isCamelCase } from '../../../src/utils/index.ts';

describe('isCamelCase', () => {
  it('accepts a canonical camel string', () => {
    strictEqual(isCamelCase('blogPosts'), true);
  });

  it('accepts a single lowercase word', () => {
    strictEqual(isCamelCase('blog'), true);
  });

  it('accepts trailing acronyms', () => {
    strictEqual(isCamelCase('parseURL'), true);
    strictEqual(isCamelCase('userID'), true);
  });

  it('accepts digits after the first character', () => {
    strictEqual(isCamelCase('user2FA'), true);
  });

  it('rejects PascalCase', () => {
    strictEqual(isCamelCase('BlogPosts'), false);
  });

  it('rejects kebab-case', () => {
    strictEqual(isCamelCase('blog-posts'), false);
  });

  it('rejects snake_case', () => {
    strictEqual(isCamelCase('blog_posts'), false);
  });

  it('rejects a leading digit', () => {
    strictEqual(isCamelCase('2blog'), false);
  });

  it('rejects empty input', () => {
    strictEqual(isCamelCase(''), false);
  });

  it('rejects whitespace', () => {
    strictEqual(isCamelCase('blog Posts'), false);
  });
});

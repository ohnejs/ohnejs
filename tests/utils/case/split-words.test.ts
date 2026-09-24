import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { splitWords } from '../../../src/utils/index.ts';

describe('splitWords', () => {
  it('splits PascalCase to lowercase tokens', () => {
    deepStrictEqual(splitWords('BlogPosts'), ['blog', 'posts']);
  });

  it('splits camelCase to lowercase tokens', () => {
    deepStrictEqual(splitWords('featuredImage'), ['featured', 'image']);
  });

  it('splits kebab-case and snake_case', () => {
    deepStrictEqual(splitWords('blog-posts'), ['blog', 'posts']);
    deepStrictEqual(splitWords('blog_posts'), ['blog', 'posts']);
  });

  it('lowercases acronyms', () => {
    deepStrictEqual(splitWords('BlogHTMLParser'), ['blog', 'html', 'parser']);
    deepStrictEqual(splitWords('parseURL'), ['parse', 'url']);
  });

  it('keeps digits in their word', () => {
    deepStrictEqual(splitWords('user2FA'), ['user2', 'fa']);
    deepStrictEqual(splitWords('item123List'), ['item123', 'list']);
  });

  it('returns an empty array for empty or separator-only input', () => {
    deepStrictEqual(splitWords(''), []);
    deepStrictEqual(splitWords('---'), []);
  });
});

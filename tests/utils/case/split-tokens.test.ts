import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { splitTokens } from '../../../src/utils/index.ts';

describe('splitTokens', () => {
  it('splits PascalCase', () => {
    deepStrictEqual(splitTokens('BlogPosts'), ['Blog', 'Posts']);
  });

  it('splits camelCase', () => {
    deepStrictEqual(splitTokens('featuredImage'), ['featured', 'Image']);
  });

  it('splits kebab-case and snake_case', () => {
    deepStrictEqual(splitTokens('blog-posts'), ['blog', 'posts']);
    deepStrictEqual(splitTokens('blog_posts'), ['blog', 'posts']);
  });

  it('preserves casing on acronym -> word boundaries', () => {
    deepStrictEqual(splitTokens('BlogHTMLParser'), ['Blog', 'HTML', 'Parser']);
    deepStrictEqual(splitTokens('parseURL'), ['parse', 'URL']);
  });

  it('separates digits from letters', () => {
    deepStrictEqual(splitTokens('user2FA'), ['user', '2', 'FA']);
    deepStrictEqual(splitTokens('item123List'), ['item', '123', 'List']);
  });

  it('collapses runs of non-alphanumeric separators', () => {
    deepStrictEqual(splitTokens('  blog -- posts __ v2  '), ['blog', 'posts', 'v', '2']);
  });

  it('returns an empty array for empty or separator-only input', () => {
    deepStrictEqual(splitTokens(''), []);
    deepStrictEqual(splitTokens('---'), []);
    deepStrictEqual(splitTokens('___'), []);
  });
});

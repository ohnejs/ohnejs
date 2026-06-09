import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { toPascalCase } from '../../../src/utils/index.ts';

describe('toPascalCase', () => {
  it('converts kebab-case', () => {
    strictEqual(toPascalCase('blog-posts'), 'BlogPosts');
  });

  it('converts snake_case', () => {
    strictEqual(toPascalCase('blog_posts'), 'BlogPosts');
  });

  it('converts camelCase', () => {
    strictEqual(toPascalCase('blogPosts'), 'BlogPosts');
  });

  it('keeps an already-Pascal string unchanged', () => {
    strictEqual(toPascalCase('BlogPosts'), 'BlogPosts');
  });

  it('handles single-character input', () => {
    strictEqual(toPascalCase('x'), 'X');
  });

  it('returns an empty string for empty input', () => {
    strictEqual(toPascalCase(''), '');
  });

  it('returns an empty string for separator-only input', () => {
    strictEqual(toPascalCase('---'), '');
  });

  it('preserves acronym casing in every position', () => {
    strictEqual(toPascalCase('HTML'), 'HTML');
    strictEqual(toPascalCase('html'), 'Html');
    strictEqual(toPascalCase('HTML-parser'), 'HTMLParser');
    strictEqual(toPascalCase('HTMLParser'), 'HTMLParser');
    strictEqual(toPascalCase('parserHTML'), 'ParserHTML');
    strictEqual(toPascalCase('parser-HTML'), 'ParserHTML');
    strictEqual(toPascalCase('HTML_parser'), 'HTMLParser');
    strictEqual(toPascalCase('blog-HTML-parser'), 'BlogHTMLParser');
    strictEqual(toPascalCase('BlogHTMLParser'), 'BlogHTMLParser');
    strictEqual(toPascalCase('parseURL'), 'ParseURL');
    strictEqual(toPascalCase('userID'), 'UserID');
  });
});

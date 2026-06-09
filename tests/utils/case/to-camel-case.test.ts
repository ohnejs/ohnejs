import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { toCamelCase } from '../../../src/utils/index.ts';

describe('toCamelCase', () => {
  it('converts kebab-case', () => {
    strictEqual(toCamelCase('blog-posts'), 'blogPosts');
  });

  it('converts snake_case', () => {
    strictEqual(toCamelCase('blog_posts'), 'blogPosts');
  });

  it('converts PascalCase', () => {
    strictEqual(toCamelCase('BlogPosts'), 'blogPosts');
  });

  it('keeps an already-camel string unchanged', () => {
    strictEqual(toCamelCase('blogPosts'), 'blogPosts');
  });

  it('handles single-character input', () => {
    strictEqual(toCamelCase('X'), 'x');
    strictEqual(toCamelCase('x'), 'x');
  });

  it('returns an empty string for empty input', () => {
    strictEqual(toCamelCase(''), '');
  });

  it('returns an empty string for separator-only input', () => {
    strictEqual(toCamelCase('---'), '');
  });

  it('lowercases a leading acronym entirely and preserves trailing acronyms', () => {
    strictEqual(toCamelCase('HTML'), 'html');
    strictEqual(toCamelCase('html'), 'html');
    strictEqual(toCamelCase('HTML-content'), 'htmlContent');
    strictEqual(toCamelCase('HTMLContent'), 'htmlContent');
    strictEqual(toCamelCase('HTMLParser'), 'htmlParser');
    strictEqual(toCamelCase('contentHTML'), 'contentHTML');
    strictEqual(toCamelCase('content-HTML'), 'contentHTML');
    strictEqual(toCamelCase('HTML_content'), 'htmlContent');
    strictEqual(toCamelCase('blog-HTML-parser'), 'blogHTMLParser');
    strictEqual(toCamelCase('BlogHTMLParser'), 'blogHTMLParser');
    strictEqual(toCamelCase('parseURL'), 'parseURL');
    strictEqual(toCamelCase('userID'), 'userID');
  });
});

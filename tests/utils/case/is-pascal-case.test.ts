import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isPascalCase } from '../../../src/utils/index.ts';

describe('isPascalCase', () => {
  it('accepts a canonical pascal string', () => {
    strictEqual(isPascalCase('BlogPosts'), true);
  });

  it('accepts a single uppercase-led word', () => {
    strictEqual(isPascalCase('Blog'), true);
  });

  it('accepts embedded acronyms', () => {
    strictEqual(isPascalCase('HTMLParser'), true);
    strictEqual(isPascalCase('ParserHTML'), true);
  });

  it('accepts an all-uppercase acronym', () => {
    strictEqual(isPascalCase('HTML'), true);
  });

  it('accepts digits after the first character', () => {
    strictEqual(isPascalCase('User2FA'), true);
  });

  it('rejects camelCase', () => {
    strictEqual(isPascalCase('blogPosts'), false);
  });

  it('rejects kebab-case', () => {
    strictEqual(isPascalCase('Blog-Posts'), false);
  });

  it('rejects snake_case', () => {
    strictEqual(isPascalCase('Blog_Posts'), false);
  });

  it('rejects a leading digit', () => {
    strictEqual(isPascalCase('2Blog'), false);
  });

  it('rejects empty input', () => {
    strictEqual(isPascalCase(''), false);
  });

  it('rejects whitespace', () => {
    strictEqual(isPascalCase('Blog Posts'), false);
  });
});

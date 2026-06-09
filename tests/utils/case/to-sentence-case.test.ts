import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { toSentenceCase } from '../../../src/utils/index.ts';

describe('toSentenceCase', () => {
  it('converts camelCase', () => {
    strictEqual(toSentenceCase('firstName'), 'First name');
  });

  it('converts PascalCase', () => {
    strictEqual(toSentenceCase('BlogPost'), 'Blog post');
  });

  it('converts kebab-case', () => {
    strictEqual(toSentenceCase('first-name'), 'First name');
  });

  it('converts snake_case', () => {
    strictEqual(toSentenceCase('first_name'), 'First name');
  });

  it('handles a single lowercase word', () => {
    strictEqual(toSentenceCase('email'), 'Email');
  });

  it('handles a single already-capitalized word', () => {
    strictEqual(toSentenceCase('Email'), 'Email');
  });

  it('preserves trailing acronyms', () => {
    strictEqual(toSentenceCase('parseHTML'), 'Parse HTML');
    strictEqual(toSentenceCase('getAPIResponse'), 'Get API response');
  });

  it('preserves a leading acronym', () => {
    strictEqual(toSentenceCase('HTMLParser'), 'HTML parser');
  });

  it('preserves a standalone acronym', () => {
    strictEqual(toSentenceCase('HTML'), 'HTML');
  });

  it('preserves acronyms across snake_case separators', () => {
    strictEqual(toSentenceCase('HTML_parser'), 'HTML parser');
  });

  it('separates letters and digits as distinct words', () => {
    strictEqual(toSentenceCase('v2Release'), 'V 2 release');
  });

  it('returns an empty string for empty input', () => {
    strictEqual(toSentenceCase(''), '');
  });

  it('returns an empty string for separator-only input', () => {
    strictEqual(toSentenceCase('---'), '');
  });
});
